import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../api-error.js';
import { checkRateLimit } from '../identity/rate-limit.js';
import { privateAttachmentResponse } from '../private-attachment-response.js';

const DOWNLOADS_PER_MINUTE = 30;
const DOWNLOAD_WINDOW_MS = 60 * 1000;

/** Call only after session/ACL validation. Limits S3 reads and hides storage errors. */
export async function dpDownloadResponse(request, actorKey, load) {
  try {
    const rate = await checkRateLimit(`dp-download:${actorKey}`, DOWNLOADS_PER_MINUTE, DOWNLOAD_WINDOW_MS);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));
    const result = await load();
    if (!result.ok) return apiErrorFromResult(request, result);
    return privateAttachmentResponse(result);
  } catch {
    // Storage service records diagnostics; never log document bytes or file names here.
    return apiError(request, ERR.INTERNAL, httpStatusForError(ERR.INTERNAL));
  }
}
