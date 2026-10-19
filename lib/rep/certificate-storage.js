import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { addAbortSignal } from 'node:stream';

const CERTIFICATE_MAX_BYTES = 1024 * 1024;
const CERTIFICATE_DOWNLOAD_TIMEOUT_MS = 15000;

/** Server-only bootstrap configuration. Admin inputs are validated separately. */
export function signingStorageConfig(env = process.env) {
  const bucket = env.REP_SIGNING_S3_BUCKET?.trim();
  const key = env.REP_SIGNING_S3_KEY;
  if (
    !bucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !key?.trim() ||
    Buffer.byteLength(key, 'utf8') > 1024 ||
    /[\u0000-\u001f\u007f]/.test(key)
  )
    return null;
  return {
    bucket,
    key,
    region:
      env.REP_SIGNING_S3_REGION?.trim() ||
      env.AWS_REGION?.trim() ||
      'us-east-1',
    versionId: env.REP_SIGNING_S3_VERSION_ID?.trim() || undefined,
  };
}

/** Read the encrypted PKCS#12 using the AWS SDK credential chain (including IAM roles). */
export async function loadSigningP12(config = signingStorageConfig()) {
  if (!config) throw new Error('REP_SIGNING_NOT_CONFIGURED');
  const client = new S3Client({ region: config.region, maxAttempts: 2 });
  const signal = AbortSignal.timeout(CERTIFICATE_DOWNLOAD_TIMEOUT_MS);
  let body;
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: config.key,
        ...(config.versionId ? { VersionId: config.versionId } : {}),
      }),
      { abortSignal: signal },
    );
    body = response.Body;
    if (!body || !body[Symbol.asyncIterator]) throw new Error();
    if (response.ContentLength > CERTIFICATE_MAX_BYTES) throw new Error();
    // AWS SDK Node.js responses are Readable streams. Bind the deadline to body
    // consumption as well as the request so a stalled download cannot hang signing.
    addAbortSignal(signal, body);
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > CERTIFICATE_MAX_BYTES) throw new Error();
      chunks.push(bytes);
    }
    if (!size) throw new Error();
    return Buffer.concat(chunks, size);
  } catch {
    // Do not expose AWS error messages, object references, or certificate bytes.
    throw new Error('REP_SIGNING_UNAVAILABLE');
  } finally {
    body?.destroy?.();
    client.destroy();
  }
}
