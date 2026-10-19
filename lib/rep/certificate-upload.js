import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { withSigningCertificate } from './signing.js';
import { publicCertificateSettings, writeSigningSettings } from './certificate-settings.js';

export const CERTIFICATE_MAX_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = CERTIFICATE_MAX_BYTES + 16384;
const fieldsSchema = z.object({
  action: z.enum(['test', 'save']),
  password: z.string().max(1024).refine(value => !value.includes('\0')),
}).strict();

export async function readCertificateUpload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data;') || !request.body) throw new Error('INVALID_UPLOAD');
  const length = Number(request.headers.get('content-length'));
  if (length > MAX_REQUEST_BYTES) throw new Error('INVALID_UPLOAD');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 15000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) throw new Error('INVALID_UPLOAD');
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData();
    const keys = [...form.keys()];
    if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(key => !['action', 'password', 'file'].includes(key))) throw new Error('INVALID_UPLOAD');
    const fields = fieldsSchema.parse({ action: form.get('action'), password: form.get('password') });
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function' || !/\.(p12|pfx)$/i.test(file.name) || !file.size || file.size > CERTIFICATE_MAX_BYTES) throw new Error('INVALID_UPLOAD');
    return { ...fields, p12: Buffer.from(await file.arrayBuffer()) };
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => {});
  }
}

export async function validateAndSaveUploadedCertificate({ action, password, p12 }) {
  const prefix = process.env.REP_SIGNING_UPLOAD_PREFIX?.trim() || 'private/rep/a1/';
  if (!/^private\/(?:[a-zA-Z0-9_-]+\/)+$/.test(prefix)) { p12.fill(0); throw new Error('REP_SIGNING_UNAVAILABLE'); }
  const settings = {
    bucket: '30grow', region: 'us-west-2',
    key: `${prefix}${randomUUID()}.p12`, password,
  };
  try {
    const certificate = await withSigningCertificate(async ({ sign, certificate }) => {
      await sign(Buffer.from('30Grow certificate validation', 'utf8'));
      return certificate;
    }, { settings, p12 });
    const validated = { ...settings, certificate, validatedAt: new Date().toISOString() };
    if (action === 'save') {
      const client = new S3Client({ region: settings.region, maxAttempts: 2 });
      try {
        const uploaded = await client.send(new PutObjectCommand({
          Bucket: settings.bucket, Key: settings.key, Body: p12,
          ContentType: 'application/x-pkcs12', ServerSideEncryption: 'AES256',
          CacheControl: 'private, no-store', IfNoneMatch: '*',
        }), { abortSignal: AbortSignal.timeout(15000) });
        if (uploaded.VersionId) validated.versionId = uploaded.VersionId;
      } finally { client.destroy(); }
      // Upload to a new key first. A failed renewal never overwrites the active A1.
      // Do not delete on ambiguous secret-write timeout: it may already be active.
      await writeSigningSettings(validated);
    }
    return publicCertificateSettings(validated);
  } finally { p12.fill(0); }
}
