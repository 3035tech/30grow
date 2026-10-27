/**
 * Logo da empresa: validação + chave S3. Persistência no DB = logo_url + logo_key (não BYTEA).
 */

import crypto from 'node:crypto';
import {
  deleteObjectBestEffort,
  isObjectStorageConfigured,
  putObject,
  withObjectKeyPrefix,
  companyScopedObjectKey,
} from '../s3-object-storage.js';
import {
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_MIME_TO_EXT,
} from './company-logo-limits.js';
import { bufferMatchesImageMime } from '../file-magic.js';

export {
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_MIME_TO_EXT,
  COMPANY_LOGO_MAX_EDGE,
  COMPANY_LOGO_SOURCE_MAX_BYTES,
  COMPANY_LOGO_ACCEPT,
} from './company-logo-limits.js';


export function isCompanyLogoStorageConfigured() {
  return isObjectStorageConfigured();
}

export function companyLogoObjectKey(companyId, ext) {
  const safeExt = String(ext || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
  // Logos keep S3_KEY_PREFIX (image/logo) + companies/{id}/… for existing URLs/IAM.
  return withObjectKeyPrefix(
    companyScopedObjectKey(companyId, `${crypto.randomUUID()}.${safeExt}`)
  );
}

/**
 * @param {{ mimeType?: string, size?: number, buffer?: Buffer }} file
 * @returns {{ mimeType: string, ext: string }}
 */
export function assertValidCompanyLogoFile(file = {}) {
  const mimeType = String(file.mimeType || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
  const ext = COMPANY_LOGO_MIME_TO_EXT[mimeType];
  if (!ext) {
    const err = new Error('INVALID_LOGO_TYPE');
    err.code = 'INVALID_LOGO_TYPE';
    throw err;
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0 || size > COMPANY_LOGO_MAX_BYTES) {
    const err = new Error('INVALID_LOGO_SIZE');
    err.code = 'INVALID_LOGO_SIZE';
    throw err;
  }
  if (file.buffer != null && (!Buffer.isBuffer(file.buffer) || file.buffer.length !== size)) {
    // Allow size from metadata when buffer length matches; if buffer present, trust length.
    if (Buffer.isBuffer(file.buffer) && file.buffer.length > COMPANY_LOGO_MAX_BYTES) {
      const err = new Error('INVALID_LOGO_SIZE');
      err.code = 'INVALID_LOGO_SIZE';
      throw err;
    }
  }
  if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    if (!bufferMatchesImageMime(file.buffer, mimeType)) {
      const err = new Error('INVALID_LOGO_TYPE');
      err.code = 'INVALID_LOGO_TYPE';
      throw err;
    }
  }
  return { mimeType, ext };
}

/**
 * Upload para S3 e retorna { logoUrl, logoKey }. Não grava no Postgres.
 * @param {number} companyId
 * @param {{ buffer: Buffer, mimeType: string }} file
 */
export async function uploadCompanyLogoObject(companyId, file) {
  if (!isCompanyLogoStorageConfigured()) {
    const err = new Error('STORAGE_NOT_CONFIGURED');
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
  const buf = file?.buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    const err = new Error('INVALID_LOGO_SIZE');
    err.code = 'INVALID_LOGO_SIZE';
    throw err;
  }
  const { mimeType, ext } = assertValidCompanyLogoFile({
    mimeType: file.mimeType,
    size: buf.length,
    buffer: buf,
  });
  const key = companyLogoObjectKey(companyId, ext);
  const { url } = await putObject({ key, body: buf, contentType: mimeType });
  return { logoUrl: url, logoKey: key };
}

/**
 * Remove objeto antigo do bucket (best-effort) após troca/remoção.
 */
export async function removeCompanyLogoObject(logoKey) {
  return deleteObjectBestEffort(logoKey);
}

export const COMPANY_LOGO_SQL_SELECT = `
  c.logo_url AS "logoUrl",
  c.logo_key AS "logoKey"`.trim();
