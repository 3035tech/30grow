import { ERR } from './api-error-codes.js';

export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * Reads a multipart body with a hard byte cap (file limit + multipart overhead) instead of
 * trusting Content-Length. Throws `{ code: ERR.INVALID_CV_FILE_SIZE }` past the cap and
 * returns null when the body is missing or not valid multipart.
 */
export async function readBoundedFormData(request, maxFileBytes) {
  const cap = maxFileBytes + MULTIPART_OVERHEAD_BYTES;
  if (Number(request.headers.get('content-length')) > cap) {
    throw Object.assign(new Error('upload_limit'), { code: ERR.INVALID_CV_FILE_SIZE });
  }
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) {
        await reader.cancel();
        throw Object.assign(new Error('upload_limit'), { code: ERR.INVALID_CV_FILE_SIZE });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks), {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
  } catch {
    return null;
  }
}

/** The single `file` field of a multipart form, or null when the form has anything else. */
export function singleFormFile(form) {
  if (!form) return null;
  const file = form.get('file');
  if ([...form.keys()].some((key) => key !== 'file') || form.getAll('file').length !== 1) return null;
  if (!file || typeof file.arrayBuffer !== 'function') return null;
  return file;
}
