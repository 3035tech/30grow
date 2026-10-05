import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { withTransaction } from '../../../../../../lib/db.js';
import { publishFormalReviewCycle } from '../../../../../../lib/people/formal-competency-reviews.js';
import { audit } from '../../../../../../lib/audit.js';

export const POST = withAdminApi({ cap: CAP.PERFORMANCE_VIEW, body: z.object({ companyId: zPositiveInt.optional() }), companyFrom: 'body', logLabel: 'formal-cycle-publish' }, async ({ request, payload, companyId, params }) => {
  const cycleId = Number(params?.id);
  if (!Number.isSafeInteger(cycleId) || cycleId <= 0) return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
  try {
    const count = await withTransaction(async db => {
      const result = await publishFormalReviewCycle(db, { companyId, cycleId });
      if (!result.ok) {
        const error = new Error('Cycle publication rejected');
        error.publicationResult = result;
        throw error;
      }
      return result.count;
    });
    await audit({ actorUserId: payload.userId, action: 'formal_review_cycle_publish', targetType: 'formal_review_cycle', targetId: cycleId, metadata: { companyId, count } });
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    if (error.publicationResult) return apiErrorFromResult(request, error.publicationResult);
    throw error;
  }
});
