import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../../lib/db.js';
import { DP_DOCUMENT_KEYS } from '../../../../../../../../lib/domain-status.js';
import { NOTIF } from '../../../../../../../../lib/manager-notification-catalog.js';
import { notifyCompanyManagers } from '../../../../../../../../lib/manager-notifications.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../lib/mobile-employee-session.js';
import { clearDpDocumentFile, downloadDpDocumentFile, getEmployeeDisplayName, getEmployeeDpHome, uploadDpDocumentFile } from '../../../../../../../../lib/people/employee-dp.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const DOCUMENT_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) { return getEmployeeDpHome({ query }, session); }
async function context(request, props) {
  const session = await auth(request);
  if (!session) return { error: apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED) };
  const params = await props.params;
  const docKey = String(params?.docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(docKey)) return { error: apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST) };
  return { docKey, session };
}
async function writeLimit(request, session) {
  return checkRateLimit(`mobile-employee-dp-doc:${session.candidateId}:${clientIpFromRequest(request)}`, DOCUMENT_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
}

export async function GET(request, props) {
  try {
    const ctx = await context(request, props);
    if (ctx.error) return ctx.error;
    const result = await downloadDpDocumentFile({ query }, { companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, docKey: ctx.docKey });
    if (!result.ok) return apiErrorFromResult(request, result);
    const safeName = result.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new NextResponse(result.body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="${safeName}"`, 'Content-Type': result.contentType } });
  } catch (error) {
    console.error('GET mobile employee dp document', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request, props) {
  try {
    const ctx = await context(request, props);
    if (ctx.error) return ctx.error;
    const limit = await writeLimit(request, ctx.session);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadDpDocumentFile({ query }, { companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, docKey: ctx.docKey, file: { buffer, size: buffer.length, mimeType: file.type, originalName: file.name } });
    if (!result.ok) return apiErrorFromResult(request, result);
    try {
      const candidateName = await getEmployeeDisplayName({ query }, ctx.session);
      const day = new Date().toISOString().slice(0, 10);
      await notifyCompanyManagers(query, { companyId: ctx.session.companyId, type: NOTIF.DP_DOC_UPLOADED, entityType: 'candidate', entityId: ctx.session.candidateId, dedupeKey: `mobile:dp_doc_up:${ctx.session.candidateId}:${ctx.docKey}:${day}`, payload: { candidateId: ctx.session.candidateId, candidateName, docKey: ctx.docKey } });
    } catch (error) { console.error('mobile employee document notification', error?.message || error); }
    const home = await load(ctx.session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee dp document', error);
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(error?.code)) return apiError(request, error.code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : error.code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : error.code, HTTP_STATUS.BAD_REQUEST);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function DELETE(request, props) {
  try {
    const ctx = await context(request, props);
    if (ctx.error) return ctx.error;
    const limit = await writeLimit(request, ctx.session);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const result = await clearDpDocumentFile({ query }, { companyId: ctx.session.companyId, candidateId: ctx.session.candidateId, docKey: ctx.docKey });
    if (!result.ok) return apiErrorFromResult(request, result);
    const home = await load(ctx.session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('DELETE mobile employee dp document', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
