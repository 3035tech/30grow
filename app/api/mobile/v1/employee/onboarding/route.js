import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { ONBOARDING_ACK_KIND } from '../../../../../../lib/domain-status.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { employeeAckOnboardingItem, getEmployeeOnboardingJourney } from '../../../../../../lib/people/employee-onboarding-journey.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) {
  return getEmployeeOnboardingJourney(null, { companyId: session.companyId, candidateId: session.candidateId });
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await load(session);
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee onboarding', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function PATCH(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-onboarding:${session.candidateId}:${clientIpFromRequest(request)}`, 30, 10 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const kind = body.kind === ONBOARDING_ACK_KIND.PRE || body.kind === ONBOARDING_ACK_KIND.CHECKIN ? body.kind : null;
    const itemId = Number(body.itemId);
    if (!kind || !Number.isInteger(itemId) || itemId < 1) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await employeeAckOnboardingItem(null, { companyId: session.companyId, candidateId: session.candidateId, kind, itemId });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    const journey = await load(session);
    return NextResponse.json(journey, { headers: NO_STORE });
  } catch (error) {
    console.error('PATCH mobile employee onboarding', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
