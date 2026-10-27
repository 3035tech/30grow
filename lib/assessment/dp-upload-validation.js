// Browser-safe preflight. The server remains authoritative and checks file bytes.
export const DP_DOC_MAX_BYTES = 5 * 1024 * 1024;
export const DP_DOC_ALLOWED_MIMES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);

export function dpUploadValidationKey(file) {
  if (!Number.isFinite(file?.size) || file.size <= 0 || file.size > DP_DOC_MAX_BYTES) return 'fileSizeError';
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  if (!['pdf', 'jpg', 'jpeg', 'png'].includes(extension) || (mime && !DP_DOC_ALLOWED_MIMES.includes(mime))) return 'fileTypeError';
  return null;
}

export function dpUploadResponseKey(status, code) {
  if (status === 401) return 'fileSessionError';
  if (code === 'DP_FILE_SIZE' || code === 'INVALID_CV_FILE_SIZE' || status === 413) return 'fileSizeError';
  if (code === 'DP_FILE_TYPE' || code === 'INVALID_CV_FILE_TYPE') return 'fileTypeError';
  return null;
}
