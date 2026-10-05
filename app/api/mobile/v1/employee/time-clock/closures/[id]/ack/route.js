import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../../../lib/api-error.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../../lib/mobile-employee-session.js';
import { CLOSURE_ACK_RATE_LIMIT, CLOSURE_ACK_RATE_WINDOW_MS, submitEmployeeClosureAck } from '../../../../../../../../../lib/people/time-clock-request-api.js';
import { checkRateLimit } from '../../../../../../../../../lib/rate-limit.js';
import { zPositiveInt } from '../../../../../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request, props) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const params = await props.params;
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    const limit = await checkRateLimit(`emp-tc-ack:${session.candidateId}`, CLOSURE_ACK_RATE_LIMIT, CLOSURE_ACK_RATE_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const result = await submitEmployeeClosureAck(request, session, parsed.data, await request.json().catch(() => ({})));
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item }, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee time closure ack', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
