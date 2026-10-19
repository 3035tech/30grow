import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { query } from '../../../../../../lib/db.js';
import { TIME_PUNCH_KINDS } from '../../../../../../lib/domain-status.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { mobileIdempotencyKey } from '../../../../../../lib/mobile-idempotency.js';
import { createTimePunch, getEmployeeTimeClockToday } from '../../../../../../lib/people/time-clock.js';
import { parsePunchCoordinates } from '../../../../../../lib/time-clock-format.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const PUNCH_RATE_LIMIT = 40;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) { return getEmployeeTimeClockToday({ query }, session); }

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await load(session);
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee time clock', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-punch:${session.candidateId}:${clientIpFromRequest(request)}`, PUNCH_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = mobileIdempotencyKey(request);
    const coords = parsePunchCoordinates(body.latitude, body.longitude);
    if (!idempotencyKey || !TIME_PUNCH_KINDS.includes(body.punchKind)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await createTimePunch({ query }, { companyId: session.companyId, candidateId: session.candidateId, punchKind: body.punchKind, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, collector: '01', idempotencyKey });
    if (!result.ok) return apiErrorFromResult(request, result);
    const today = await load(session);
    if (!today.ok) return apiErrorFromResult(request, today);
    return NextResponse.json(today, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee time clock', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
