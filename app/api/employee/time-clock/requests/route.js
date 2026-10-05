/**
 * POST /api/employee/time-clock/requests — punch adjustment or excuse request (pending approval).
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../../lib/rate-limit.js';
import {
  TIME_REQUEST_RATE_LIMIT,
  TIME_REQUEST_RATE_WINDOW_MS,
  submitEmployeeTimeRequest,
} from '../../../../../lib/people/time-clock-request-api.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const rl = await checkRateLimit(`emp-time-request:${session.candidateId}`, TIME_REQUEST_RATE_LIMIT, TIME_REQUEST_RATE_WINDOW_MS);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const result = await submitEmployeeTimeRequest(request, session, await request.json().catch(() => ({})));
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/time-clock/requests', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
