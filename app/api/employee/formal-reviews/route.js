import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import {
  listSentFormalReviewsForEmployee,
  getSentFormalReviewForEmployee,
} from '../../../../lib/people/formal-competency-reviews.js';

export const dynamic = 'force-dynamic';

/** GET /api/employee/formal-reviews — list sent reviews or one detail (?id=) */
export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const url = new URL(request.url);
    const reviewId = url.searchParams.get('id');
    if (reviewId) {
      const result = await getSentFormalReviewForEmployee(query, {
        companyId: session.companyId,
        candidateId: session.candidateId,
        reviewId,
      });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
      }
      return NextResponse.json({ ok: true, review: result.review });
    }

    const reviews = await listSentFormalReviewsForEmployee(query, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    return NextResponse.json({ ok: true, reviews });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee formal-reviews', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
