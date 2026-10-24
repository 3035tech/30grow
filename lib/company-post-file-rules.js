import { ERR } from './api-error-codes.js';
// Browser-safe selection rules; the server also validates the actual bytes.
export const POST_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const POST_FILE_MAX_COUNT = 5;
export const POST_FILE_TYPES = Object.freeze({
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',txt:'text/plain',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
export const POST_FILE_ACCEPT = Object.keys(POST_FILE_TYPES).map(ext=>'.'+ext).join(',');
export function postFileSelectionError(file) {
  if(!file?.size || file.size>POST_FILE_MAX_BYTES)return ERR.COMPANY_POST_FILE_SIZE;
  const ext=String(file.name||'').split('.').pop().toLowerCase();
  const type=String(file.type||'').split(';')[0].trim().toLowerCase();
  if(!POST_FILE_TYPES[ext] || (type && type!=='application/octet-stream' && type!==POST_FILE_TYPES[ext]))return ERR.COMPANY_POST_FILE_TYPE;
  return null;
}
