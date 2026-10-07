import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../../../lib/api-error.js';
import { query, withTransaction } from '../../../../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../../lib/mobile-employee-session.js';
import { DP_DOC_MAX_BYTES, clearLeaveAttachment, downloadLeaveAttachment, getEmployeeDisplayName, getEmployeeDpHome, uploadLeaveAttachment } from '../../../../../../../../../lib/people/employee-dp.js';
import { checkRateLimit } from '../../../../../../../../../lib/rate-limit.js';
import { notifyCompanyManagers } from '../../../../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../../../../lib/manager-notification-catalog.js';
import { readBoundedFormData, singleFormFile } from '../../../../../../../../../lib/bounded-multipart.js';

export const dynamic = 'force-dynamic';
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
async function context(request, props) {
  const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
  if (!session) return { error: apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED) };
  const { id } = await props.params;
  if (!/^[1-9]\d*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) return { error: apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST) };
  return { session, id: Number(id) };
}
export async function GET(request, props) {
  try {
    const ctx = await context(request, props); if (ctx.error) return ctx.error;
    const result = await downloadLeaveAttachment({ query }, { id: ctx.id, ...ctx.session });
    if (!result.ok) return apiErrorFromResult(request, result);
    const name = result.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new NextResponse(result.body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': result.contentType, 'Content-Disposition': `attachment; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch { return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR); }
}
export async function POST(request, props) {
  try {
    const ctx = await context(request, props); if (ctx.error) return ctx.error;
    const limit = await checkRateLimit(`mobile-leave-file:${ctx.session.companyId}:${ctx.session.candidateId}`, UPLOAD_LIMIT, UPLOAD_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const file = singleFormFile(await readBoundedFormData(request, DP_DOC_MAX_BYTES));
    if (!file) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    if (!file.size || file.size > DP_DOC_MAX_BYTES) return apiError(request, ERR.DP_FILE_SIZE, HTTP_STATUS.BAD_REQUEST);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await withTransaction(async (client) => {
      const own = await client.query('SELECT id FROM employee_leave_requests WHERE id = $1 AND company_id = $2 AND candidate_id = $3 FOR UPDATE', [ctx.id, ctx.session.companyId, ctx.session.candidateId]);
      if (!own.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
      return uploadLeaveAttachment(client, { id: ctx.id, companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, file: { buffer, size: buffer.length, mimeType: file.type, originalName: file.name } });
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    try {
      const candidateName = await getEmployeeDisplayName({ query }, ctx.session);
      await notifyCompanyManagers(query, { companyId: ctx.session.companyId, type: NOTIF.DP_LEAVE_FILE, entityType: 'leave', entityId: ctx.id, dedupeKey: `dp_leave_file:${ctx.id}:${new Date().toISOString().slice(0, 10)}`, payload: { candidateId: ctx.session.candidateId, candidateName, leaveId: ctx.id } });
    } catch { /* Upload remains committed if the optional manager notification fails. */ }
    const home = await getEmployeeDpHome({ query }, ctx.session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(error?.code)) return apiError(request, error.code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : error.code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : error.code, HTTP_STATUS.BAD_REQUEST);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
export async function DELETE(request, props) {
  try {
    const ctx = await context(request, props); if (ctx.error) return ctx.error;
    const result = await clearLeaveAttachment({ query }, { id: ctx.id, companyId: ctx.session.companyId, candidateId: ctx.session.candidateId });
    if (!result.ok) return apiErrorFromResult(request, result);
    const home = await getEmployeeDpHome({ query }, ctx.session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR); }
}
