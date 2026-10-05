import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../../../lib/api-error.js';
import { DP_DOC_MAX_BYTES } from '../../../../../../../../../lib/dp-upload-validation.js';
import { dpDownloadResponse } from '../../../../../../../../../lib/people/dp-download-response.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../../lib/mobile-employee-session.js';
import { readBoundedFormData, singleFormFile } from '../../../../../../../../../lib/bounded-multipart.js';
import { clearTimeRequestAttachment, downloadTimeRequestAttachment, uploadTimeRequestAttachment } from '../../../../../../../../../lib/people/time-clock-requests.js';
import { checkRateLimit } from '../../../../../../../../../lib/rate-limit.js';
import { zPositiveInt } from '../../../../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

async function context(request, params) {
  const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
  if (!session) return { error: apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED) };
  const parsed = zPositiveInt.safeParse((await params)?.id);
  if (!parsed.success) return { error: apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST) };
  return { session, id: parsed.data };
}

export async function GET(request, { params }) {
  const ctx = await context(request, params); if (ctx.error) return ctx.error;
  return dpDownloadResponse(request, `mobile-employee:${ctx.session.candidateId}`, () =>
    downloadTimeRequestAttachment({ companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, id: ctx.id })
  );
}

export async function POST(request, { params }) {
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    const limit = await checkRateLimit(`mobile-time-request-file:${ctx.session.companyId}:${ctx.session.candidateId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const file = singleFormFile(await readBoundedFormData(request, DP_DOC_MAX_BYTES));
    if (!file) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    if (!file.size || file.size > DP_DOC_MAX_BYTES) return apiError(request, ERR.INVALID_CV_FILE_SIZE, HTTP_STATUS.BAD_REQUEST);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadTimeRequestAttachment({
      companyId: ctx.session.companyId,
      candidateId: ctx.session.candidateId,
      id: ctx.id,
      file: { buffer, size: buffer.length, mimeType: file.type, originalName: file.name },
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error?.code === ERR.INVALID_CV_FILE_SIZE || error?.code === ERR.INVALID_CV_FILE_TYPE) return apiError(request, error.code, HTTP_STATUS.BAD_REQUEST);
    console.error('POST mobile employee time request file', error?.message || error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function DELETE(request, { params }) {
  try {
    const ctx = await context(request, params); if (ctx.error) return ctx.error;
    const result = await clearTimeRequestAttachment({ companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, id: ctx.id });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('DELETE mobile employee time request file', error?.message || error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
