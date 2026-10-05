import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile-employee-session.js';
import { TIME_REQUEST_RATE_LIMIT, TIME_REQUEST_RATE_WINDOW_MS, submitEmployeeTimeRequest } from '../../../../../../../lib/people/time-clock-request-api.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-time-request:${session.candidateId}:${clientIpFromRequest(request)}`, TIME_REQUEST_RATE_LIMIT, TIME_REQUEST_RATE_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const result = await submitEmployeeTimeRequest(request, session, await request.json().catch(() => ({})));
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item }, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee time request', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
