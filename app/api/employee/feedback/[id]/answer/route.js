/**
 * POST /api/employee/feedback/[id]/answer — answer pending request as recipient
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../../lib/employee/employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';
import { query } from '../../../../../../lib/db.js';
import { answerFeedbackRequest } from '../../../../../../lib/people/continuous-feedback.js';

export const dynamic = 'force-dynamic';

export async function POST(request, props) {
  const params = await props.params;
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `emp-feedback-ans:${session.candidateId}:${ip}`,
      30,
      60 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const id = Number(params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return apiError(request, ERR.NOT_FOUND, 404);
    }

    const tok = await query(
      `SELECT token FROM feedback_requests
       WHERE id = $1 AND company_id = $2 AND to_candidate_id = $3
       LIMIT 1`,
      [id, session.companyId, session.candidateId]
    );
    if (!tok.rowCount) return apiError(request, ERR.NOT_FOUND, 404);

    const body = await request.json().catch(() => ({}));
    const result = await answerFeedbackRequest(null, {
      token: tok.rows[0].token,
      responseText: body.responseText,
      answeredByCandidateId: session.candidateId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, answeredAt: result.answeredAt });
  } catch (err) {
    console.error('POST /api/employee/feedback answer', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
