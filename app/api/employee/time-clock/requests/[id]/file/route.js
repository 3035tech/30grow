/**
 * GET/POST/DELETE /api/employee/time-clock/requests/[id]/file — proof attached to an own request.
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../../../../lib/rate-limit.js';
import { zPositiveInt } from '../../../../../../../lib/validate.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';
import { readBoundedFormData, singleFormFile } from '../../../../../../../lib/bounded-multipart.js';
import { DP_DOC_MAX_BYTES } from '../../../../../../../lib/dp-upload-validation.js';
import {
  clearTimeRequestAttachment,
  downloadTimeRequestAttachment,
  uploadTimeRequestAttachment,
} from '../../../../../../../lib/people/time-clock-requests.js';

export const dynamic = 'force-dynamic';

async function sessionAndId(request, params) {
  const session = await getEmployeeSessionPayload();
  if (!session) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  const parsed = zPositiveInt.safeParse((await params)?.id);
  if (!parsed.success) return { error: apiError(request, ERR.INVALID_ID, 400) };
  return { session, id: parsed.data };
}

export async function GET(request, { params }) {
  try {
    const { session, id, error } = await sessionAndId(request, params);
    if (error) return error;
    return dpDownloadResponse(request, `employee:${session.candidateId}`, () =>
      downloadTimeRequestAttachment({ companyId: session.companyId, candidateId: session.candidateId, id })
    );
  } catch {
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request, { params }) {
  try {
    const { session, id, error } = await sessionAndId(request, params);
    if (error) return error;
    const rl = await checkRateLimit(`emp-time-request-file:${session.candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);
    const file = singleFormFile(await readBoundedFormData(request, DP_DOC_MAX_BYTES));
    if (!file) return apiError(request, ERR.INVALID_DATA, 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadTimeRequestAttachment({
      companyId: session.companyId,
      candidateId: session.candidateId,
      id,
      file: { buffer, size: buffer.length, mimeType: file.type, originalName: file.name },
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    const code = err?.code;
    if (code === ERR.INVALID_CV_FILE_SIZE || code === ERR.INVALID_CV_FILE_TYPE) {
      return apiError(request, code, 400);
    }
    console.error('POST employee time request file', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { session, id, error } = await sessionAndId(request, params);
    if (error) return error;
    const result = await clearTimeRequestAttachment({
      companyId: session.companyId,
      candidateId: session.candidateId,
      id,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error('DELETE employee time request file', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
