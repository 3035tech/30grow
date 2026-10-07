import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import {
  clearLeaveAttachment,
  downloadLeaveAttachment,
  getEmployeeDisplayName,
  uploadLeaveAttachment,
} from '../../../../../../../lib/people/employee-dp.js';
import { notifyCompanyManagers } from '../../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../../lib/manager-notification-catalog.js';
import { checkRateLimit } from '../../../../../../../lib/rate-limit.js';
import { zPositiveInt } from '../../../../../../../lib/validate.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const resolved = await params;
    const parsed = zPositiveInt.safeParse(resolved?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, 400);
    return dpDownloadResponse(request, `employee:${session.candidateId}`, () =>
      downloadLeaveAttachment({ query }, {
        id: parsed.data, companyId: session.companyId, candidateId: session.candidateId,
      })
    );
  } catch {
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST multipart atestado on own sick leave */
export async function POST(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const resolved = await params;
    const idParsed = zPositiveInt.safeParse(resolved?.id);
    if (!idParsed.success) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(
      `emp-leave-file:${session.candidateId}`,
      20,
      60 * 60 * 1000
    );
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return apiError(request, ERR.INVALID_DATA, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadLeaveAttachment(
      { query },
      {
        id: idParsed.data,
        companyId: session.companyId,
        candidateId: session.candidateId,
        file: {
          buffer,
          size: buffer.length,
          mimeType: file.type,
          originalName: file.name,
        },
      }
    );
    if (!result.ok) return apiErrorFromResult(request, result);

    try {
      const name = await getEmployeeDisplayName(
        { query },
        { companyId: session.companyId, candidateId: session.candidateId }
      );
      const today = new Date().toISOString().slice(0, 10);
      await notifyCompanyManagers(query, {
        companyId: session.companyId,
        type: NOTIF.DP_LEAVE_FILE,
        entityType: 'leave',
        entityId: result.item.id,
        dedupeKey: `dp_leave_file:${result.item.id}:${today}`,
        payload: {
          candidateId: session.candidateId,
          candidateName: name,
          leaveId: result.item.id,
        },
      });
    } catch (e) {
      console.error('[dp] leave file notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST employee leave file', err);
    const code = err?.code;
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(code)) {
      return apiError(request, code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : code, 400);
    }
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** DELETE own leave attachment */
export async function DELETE(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const resolved = await params;
    const idParsed = zPositiveInt.safeParse(resolved?.id);
    if (!idParsed.success) return apiError(request, ERR.INVALID_ID, 400);

    const result = await clearLeaveAttachment(
      { query },
      {
        id: idParsed.data,
        companyId: session.companyId,
        candidateId: session.candidateId,
      }
    );
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('DELETE employee leave file', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
