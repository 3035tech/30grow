/**
 * LMS lesson PDF upload to S3 (basic — reuse object storage like company logo).
 *
 * Keys: `companies/{companyId}/lms/courses/{courseId}/{uuid}.pdf`
 * (not under `S3_KEY_PREFIX` / `image/logo` — that prefix is for logos only).
 */

import crypto from 'node:crypto';
import {
  isObjectStorageConfigured,
  putObject,
  companyScopedObjectKey,
} from '../s3-object-storage.js';
import { isPdfBuffer } from '../file-magic.js';

export const LMS_PDF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const LMS_PDF_MIME = 'application/pdf';

const ALLOWED_DECLARED_PDF_MIMES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/acrobat',
  '',
]);

export function isLmsStorageConfigured() {
  return isObjectStorageConfigured();
}

export function assertValidLmsPdfFile(file = {}) {
  const mimeType = String(file.mimeType || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
  const size = Number(file.size);
  const bufLen = Buffer.isBuffer(file.buffer) ? file.buffer.length : size;
  if (!Number.isFinite(bufLen) || bufLen <= 0 || bufLen > LMS_PDF_MAX_BYTES) {
    const err = new Error('INVALID_LMS_FILE_SIZE');
    err.code = 'INVALID_LMS_FILE_SIZE';
    throw err;
  }

  if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    if (!isPdfBuffer(file.buffer)) {
      const err = new Error('INVALID_LMS_FILE_TYPE');
      err.code = 'INVALID_LMS_FILE_TYPE';
      throw err;
    }
    return { mimeType: LMS_PDF_MIME };
  }

  if (!ALLOWED_DECLARED_PDF_MIMES.has(mimeType)) {
    const err = new Error('INVALID_LMS_FILE_TYPE');
    err.code = 'INVALID_LMS_FILE_TYPE';
    throw err;
  }
  return { mimeType: LMS_PDF_MIME };
}

export async function uploadLmsLessonPdf(companyId, courseId, file) {
  if (!isLmsStorageConfigured()) {
    const err = new Error('STORAGE_NOT_CONFIGURED');
    err.code = 'STORAGE_NOT_CONFIGURED';
    throw err;
  }
  assertValidLmsPdfFile(file);
  const cid = Number(companyId);
  const course = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(course) || course <= 0) {
    const err = new Error('INVALID_DATA');
    err.code = 'INVALID_DATA';
    throw err;
  }
  // Tenant folder first; never apply image/logo prefix to PDFs.
  const key = companyScopedObjectKey(
    cid,
    'lms',
    'courses',
    String(course),
    `${crypto.randomUUID()}.pdf`
  );
  try {
    const { url } = await putObject({
      key,
      body: file.buffer,
      contentType: LMS_PDF_MIME,
    });
    if (!url) {
      const err = new Error('STORAGE_UPLOAD_FAILED');
      err.code = 'STORAGE_UPLOAD_FAILED';
      throw err;
    }
    return { contentUrl: url, contentKey: key, contentKind: 'pdf' };
  } catch (e) {
    if (e?.code === 'STORAGE_NOT_CONFIGURED' || e?.code === 'STORAGE_UPLOAD_FAILED') throw e;
    if (e?.code === 'INVALID_LMS_FILE_TYPE' || e?.code === 'INVALID_LMS_FILE_SIZE') throw e;
    const err = new Error('STORAGE_UPLOAD_FAILED');
    err.code = 'STORAGE_UPLOAD_FAILED';
    err.cause = e;
    throw err;
  }
}
