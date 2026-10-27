/** GET/POST manager performance review, scoped and validated by withAdminApi. */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { query as dbQuery } from '../../../../lib/db.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { getPerformanceReview, updatePerformanceReview, listPerformanceGoals } from '../../../../lib/development/performance-reviews.js';
import { listSideReviewsForCandidate } from '../../../../lib/development/performance-side-reviews.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  cycleId: zPositiveInt,
  candidateId: zPositiveInt,
});

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  cycleId: zPositiveInt,
  candidateId: zPositiveInt,
  outcomes: z.any().optional(),
  overallNotes: z.string().max(20000).nullable().optional(),
});

async function candidateExists(companyId, candidateId) {
  const result = await dbQuery(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [candidateId, companyId]
  );
  return result.rowCount > 0;
}

export const GET = withAdminApi(
  { cap: CAP.PERFORMANCE_VIEW, query: querySchema, companyFrom: 'query', logLabel: 'performance-reviews GET' },
  async ({ request, payload, companyId, query }) => {
    if (!(await candidateExists(companyId, query.candidateId))) return apiError(request, ERR.NOT_FOUND, 404);
    const result = await getPerformanceReview(null, {
      companyId,
      cycleId: query.cycleId,
      candidateId: query.candidateId,
      reviewerUserId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    const [goals, sideReviews] = await Promise.all([
      listPerformanceGoals(null, { companyId, cycleId: query.cycleId, candidateId: query.candidateId }),
      listSideReviewsForCandidate(null, { companyId, cycleId: query.cycleId, candidateId: query.candidateId }),
    ]);
    return NextResponse.json({ review: result.review, goals, sideReviews });
  }
);

export const POST = withAdminApi(
  { cap: CAP.PERFORMANCE_VIEW, body: bodySchema, companyFrom: 'body', logLabel: 'performance-reviews POST' },
  async ({ request, payload, companyId, body }) => {
    if (!(await candidateExists(companyId, body.candidateId))) return apiError(request, ERR.NOT_FOUND, 404);
    const result = await updatePerformanceReview(null, {
      companyId,
      cycleId: body.cycleId,
      candidateId: body.candidateId,
      outcomes: body.outcomes,
      overallNotes: body.overallNotes,
      reviewerUserId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json(result.review);
  }
);
