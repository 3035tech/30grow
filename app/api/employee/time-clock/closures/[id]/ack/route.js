/**
 * POST /api/employee/time-clock/closures/[id]/ack — sign (typed name + consent) or dispute a mirror.
 * Body: { action: 'signed' | 'disputed', signerName?, consent?, note? }
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../../../../lib/rate-limit.js';
import {
  CLOSURE_ACK_RATE_LIMIT,
  CLOSURE_ACK_RATE_WINDOW_MS,
  submitEmployeeClosureAck,
} from '../../../../../../../lib/people/time-clock-request-api.js';

export const dynamic = 'force-dynamic';

export async function POST(request, props) {
  const params = await props.params;
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const closureId = Number(params?.id);
    if (!Number.isFinite(closureId) || closureId <= 0) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(`emp-tc-ack:${session.candidateId}`, CLOSURE_ACK_RATE_LIMIT, CLOSURE_ACK_RATE_WINDOW_MS);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const result = await submitEmployeeClosureAck(request, session, closureId, await request.json().catch(() => ({})));
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/time-clock/closures/[id]/ack', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
