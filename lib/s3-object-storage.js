/**
 * Object storage via S3-compatible API (AWS S3, MinIO, R2 com endpoint).
 * Credenciais explícitas ou identidade gerenciada ECS/EKS; sem uma dessas fontes,
 * isObjectStorageConfigured() === false (APIs retornam 503).
 *
 * Public assets: never put the client's original filename in the object key or
 * Content-Disposition — URLs are often public; use opaqueObjectFileName().
 */

import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logger } from './monitoring.js';

let cachedClient = null;
let cachedConfigKey = '';

function trimEnv(name) {
  const v = process.env[name];
  return v == null ? '' : String(v).trim();
}

/**
 * @returns {{
 *   configured: boolean,
 *   bucket?: string,
 *   region?: string,
 *   accessKeyId?: string,
 *   secretAccessKey?: string,
 *   endpoint?: string | null,
 *   forcePathStyle?: boolean,
 *   publicBaseUrl?: string | null,
 *   keyPrefix?: string,
 * }}
 */
export function getObjectStorageConfig() {
  const bucket = trimEnv('S3_BUCKET');
  const region = trimEnv('S3_REGION') || trimEnv('AWS_REGION') || 'us-east-1';
  const accessKeyId = trimEnv('S3_ACCESS_KEY_ID') || trimEnv('AWS_ACCESS_KEY_ID');
  const secretAccessKey = trimEnv('S3_SECRET_ACCESS_KEY') || trimEnv('AWS_SECRET_ACCESS_KEY');
  const endpoint = trimEnv('S3_ENDPOINT') || null;
  const forcePathStyle =
    trimEnv('S3_FORCE_PATH_STYLE') === '1' ||
    trimEnv('S3_FORCE_PATH_STYLE').toLowerCase() === 'true' ||
    Boolean(endpoint);
  const publicBaseUrl = (trimEnv('S3_PUBLIC_BASE_URL') || '').replace(/\/$/, '') || null;
  const keyPrefix = (trimEnv('S3_KEY_PREFIX') || '').replace(/^\/+|\/+$/g, '');

  // ECS/EKS inject a refreshable credential provider. Do not require permanent
  // access keys for AWS deployments, nor silently use a developer's AWS profile.
  // Custom S3 endpoints and incomplete explicit credentials keep failing closed.
  const managedIdentity = Boolean(
    trimEnv('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI') ||
    trimEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI') ||
    (trimEnv('AWS_WEB_IDENTITY_TOKEN_FILE') && trimEnv('AWS_ROLE_ARN'))
  );
  const useManagedIdentity = managedIdentity && !endpoint && !accessKeyId && !secretAccessKey;
  const configured = Boolean(bucket && ((accessKeyId && secretAccessKey) || useManagedIdentity));
  return {
    configured,
    bucket: configured ? bucket : undefined,
    region,
    accessKeyId: configured && accessKeyId ? accessKeyId : undefined,
    secretAccessKey: configured && secretAccessKey ? secretAccessKey : undefined,
    endpoint,
    forcePathStyle,
    publicBaseUrl,
    keyPrefix,
  };
}

/** Aplica S3_KEY_PREFIX (ex. image/logo) à key relativa. */
export function withObjectKeyPrefix(relativeKey) {
  const cfg = getObjectStorageConfig();
  const rel = String(relativeKey || '').replace(/^\//, '');
  if (!rel) return rel;
  if (!cfg.keyPrefix) return rel;
  return `${cfg.keyPrefix}/${rel}`;
}

/**
 * Tenant-scoped object key: `companies/{companyId}/…segments`.
 * Use for every upload so assets are isolated by company in one shared bucket.
 * Do **not** pass through `withObjectKeyPrefix` unless the asset type belongs
 * under that prefix (logos use `image/logo`; LMS PDFs must not).
 *
 * @param {number|string} companyId
 * @param {...string} segments path parts after companies/{id}/
 * @returns {string}
 */
export function companyScopedObjectKey(companyId, ...segments) {
  const id = Number(companyId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_COMPANY');
    err.code = 'INVALID_COMPANY';
    throw err;
  }
  const parts = segments
    .map((s) => String(s || '').replace(/^\/+|\/+$/g, '').trim())
    .filter(Boolean)
    .flatMap((s) => s.split('/').filter(Boolean));
  if (!parts.length) {
    const err = new Error('INVALID_STORAGE_KEY');
    err.code = 'INVALID_STORAGE_KEY';
    throw err;
  }
  return ['companies', String(id), ...parts].join('/');
}

/**
 * Opaque basename for public (or shareable) objects — UUID + safe extension.
 * Never use `file.name` / original upload name in the key (masks PII and doc titles).
 *
 * @param {string} [ext='bin'] extension without dot
 * @returns {string} e.g. `a1b2c3d4-….pdf`
 */
export function opaqueObjectFileName(ext = 'bin') {
  const safeExt = String(ext || 'bin')
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase() || 'bin';
  return `${crypto.randomUUID()}.${safeExt}`;
}

export function isObjectStorageConfigured() {
  return getObjectStorageConfig().configured;
}

/** Lightweight connectivity check for the authenticated health endpoint. */
export async function checkObjectStorage(timeoutMs = 5000) {
  const cfg = getObjectStorageConfig();
  if (!cfg.configured) return { status: 'skipped', reason: 'not_configured' };
  const started = Date.now();
  try {
    await clientFor(cfg).send(
      new HeadBucketCommand({ Bucket: cfg.bucket }),
      { abortSignal: AbortSignal.timeout(timeoutMs) }
    );
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: error?.name || error?.code || 'storage_unavailable',
    };
  }
}

function clientFor(cfg) {
  const key = `${cfg.bucket}|${cfg.region}|${cfg.endpoint || ''}|${cfg.accessKeyId}`;
  if (cachedClient && cachedConfigKey === key) return cachedClient;
  const opts = {
    region: cfg.region,
  };
  if (cfg.accessKeyId && cfg.secretAccessKey) {
    opts.credentials = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    };
  }
  if (cfg.endpoint) {
    opts.endpoint = cfg.endpoint;
    opts.forcePathStyle = cfg.forcePathStyle !== false;
  } else if (cfg.forcePathStyle) {
    opts.forcePathStyle = true;
  }
  cachedClient = new S3Client(opts);
  cachedConfigKey = key;
  logger.info('S3 client ready', {
    bucket: cfg.bucket,
    region: cfg.region,
    endpoint: cfg.endpoint || null,
    forcePathStyle: Boolean(cfg.forcePathStyle),
    keyPrefix: cfg.keyPrefix || null,
  });
  return cachedClient;
}

/** URL pública estável para servir no browser / JSON-LD. */
export function publicUrlForObjectKey(key) {
  const cfg = getObjectStorageConfig();
  const k = String(key || '').replace(/^\//, '');
  if (!k) return null;
  if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl}/${k}`;
  if (!cfg.bucket) return null;
  if (cfg.endpoint) {
    const base = cfg.endpoint.replace(/\/$/, '');
    return cfg.forcePathStyle ? `${base}/${cfg.bucket}/${k}` : `${base}/${k}`;
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${k}`;
}

/**
 * @param {{ key: string, body: Buffer|Uint8Array, contentType: string, cacheControl?: string }} opts
 */
export async function putObject(opts) {
  const cfg = getObjectStorageConfig();
  if (!cfg.configured) {
    const err = new Error('STORAGE_NOT_CONFIGURED');
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
  const key = String(opts.key || '').replace(/^\//, '');
  if (!key) {
    const err = new Error('INVALID_STORAGE_KEY');
    err.code = 'INVALID_STORAGE_KEY';
    throw err;
  }
  const client = clientFor(cfg);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: opts.body,
        ContentType: opts.contentType || 'application/octet-stream',
        CacheControl: opts.cacheControl || 'public, max-age=31536000, immutable',
      })
    );
    logger.info('S3 putObject ok', {
      bucket: cfg.bucket,
      key,
      bytes: opts.body?.byteLength ?? opts.body?.length ?? null,
      contentType: opts.contentType || null,
    });
    return { key, url: publicUrlForObjectKey(key) };
  } catch (err) {
    logger.error('S3 putObject failed', {
      bucket: cfg.bucket,
      region: cfg.region,
      key,
      error: err?.message || String(err),
      code: err?.name || err?.Code || err?.code || null,
    });
    // Never leak raw AWS SDK errors to API routes (would become unhandled 500).
    // Ops: check S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
    // (or AWS_* aliases) for InvalidAccessKeyId, SignatureDoesNotMatch, AccessDenied, etc.
    const mapped = new Error('STORAGE_UPLOAD_FAILED');
    mapped.code = 'STORAGE_UPLOAD_FAILED';
    mapped.cause = err;
    throw mapped;
  }
}

/** Authenticated server-side read. Never returns a public URL. */
export async function getObjectBytes(key) {
  const cfg = getObjectStorageConfig();
  if (!cfg.configured) {
    const err = new Error('STORAGE_NOT_CONFIGURED');
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
  const objectKey = String(key || '').replace(/^\//, '');
  if (!objectKey) {
    const err = new Error('INVALID_STORAGE_KEY');
    err.code = 'INVALID_STORAGE_KEY';
    throw err;
  }
  try {
    const response = await clientFor(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error('EMPTY_STORAGE_OBJECT');
    return { body: bytes, contentType: response.ContentType || 'application/octet-stream' };
  } catch (err) {
    logger.warn('S3 getObject failed', { bucket: cfg.bucket, key: objectKey, error: err?.message || String(err) });
    const mapped = new Error('STORAGE_DOWNLOAD_FAILED');
    mapped.code = 'STORAGE_DOWNLOAD_FAILED';
    mapped.cause = err;
    throw mapped;
  }
}

/**
 * Best-effort delete. Missing key / not configured → no throw.
 * @param {string|null|undefined} key
 */
export async function deleteObjectBestEffort(key) {
  const k = String(key || '').replace(/^\//, '');
  if (!k) return { ok: false, skipped: true };
  const cfg = getObjectStorageConfig();
  if (!cfg.configured) return { ok: false, skipped: true };
  try {
    const client = clientFor(cfg);
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: k }));
    logger.info('S3 deleteObject ok', { bucket: cfg.bucket, key: k });
    return { ok: true };
  } catch (err) {
    logger.warn('S3 deleteObject failed', {
      bucket: cfg.bucket,
      key: k,
      error: err?.message || String(err),
    });
    return { ok: false };
  }
}
