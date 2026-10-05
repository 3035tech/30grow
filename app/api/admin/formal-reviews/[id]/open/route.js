import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { openFormalReview } from '../../../../../../lib/people/formal-competency-reviews.js';
import { audit } from '../../../../../../lib/audit.js';
import { publicAppUrl } from '../../../../../../lib/ae/require-admin.js';
import { withTransaction } from '../../../../../../lib/db.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  // Accepted for older clients; the manager respondent always comes from the subject's manager.
  managerUserId: zPositiveInt.optional().nullable(),
});

function withInviteUrls(request, review) {
  if (!review) return review;
  const base = publicAppUrl(request);
  const raters = (review.raters || []).map((r) => {
    if (!r.token || !base) return r;
    return { ...r, inviteUrl: `${base}/formal-review/${r.token}` };
  });
  return { ...review, raters };
}

/** POST /api/admin/formal-reviews/[id]/open */
export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'formal-review-open POST',
  },
  async ({ request, payload, companyId, params }) => {
    const reviewId = Number(params?.id);
    if (!Number.isFinite(reviewId) || reviewId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await withTransaction(db => openFormalReview(db, { companyId, reviewId }));
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      action: 'formal_review_open',
      actorUserId: payload.userId,
      targetType: 'formal_review',
      targetId: reviewId,
      metadata: { companyId, status: result.review.status },
    });
    return NextResponse.json({ ok: true, review: withInviteUrls(request, result.review) });
  }
);
