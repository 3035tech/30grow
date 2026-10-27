import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { DP_LEAVE_TYPES } from '../../../../../../../lib/domain-status.js';
import { NOTIF } from '../../../../../../../lib/manager-notification-catalog.js';
import { notifyCompanyManagers } from '../../../../../../../lib/manager-notifications.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile/mobile-employee-session.js';
import { cancelEmployeeLeaveRequest, createLeaveRequest, getEmployeeDisplayName, getEmployeeDpHome } from '../../../../../../../lib/people/employee-dp.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const LEAVE_ACTION = Object.freeze({ CANCEL: 'cancel', CREATE: 'create' });
const LEAVE_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) { return getEmployeeDpHome({ query }, { companyId: session.companyId, candidateId: session.candidateId }); }
async function notifyManagers(session, type, leaveId, candidateName) {
  try {
    await notifyCompanyManagers(query, { companyId: session.companyId, type, entityType: 'leave', entityId: leaveId, dedupeKey: `mobile:${type}:${leaveId}`, payload: { candidateId: session.candidateId, candidateName: candidateName || await getEmployeeDisplayName({ query }, session), leaveId } });
  } catch (error) {
    console.error('mobile employee leave notification', error?.message || error);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-leave:${session.candidateId}:${clientIpFromRequest(request)}`, LEAVE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    if (body.action !== LEAVE_ACTION.CREATE || !DP_LEAVE_TYPES.includes(body.leaveType)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await createLeaveRequest({ query }, { companyId: session.companyId, candidateId: session.candidateId, leaveType: body.leaveType, startsOn: body.startsOn, endsOn: body.endsOn, reason: body.reason, requestedBy: 'employee', autoApprove: false });
    if (!result.ok) return apiErrorFromResult(request, result);
    await notifyManagers(session, NOTIF.DP_LEAVE_REQUESTED, result.item.id, result.item.candidateName);
    const home = await load(session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee leave', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function PATCH(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-leave:${session.candidateId}:${clientIpFromRequest(request)}`, LEAVE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const leaveId = Number(body.leaveId);
    if (body.action !== LEAVE_ACTION.CANCEL || !Number.isInteger(leaveId) || leaveId < 1) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await cancelEmployeeLeaveRequest({ query }, { id: leaveId, companyId: session.companyId, candidateId: session.candidateId });
    if (!result.ok) return apiErrorFromResult(request, result);
    await notifyManagers(session, NOTIF.DP_LEAVE_CANCELLED, result.item.id);
    const home = await load(session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('PATCH mobile employee leave', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
