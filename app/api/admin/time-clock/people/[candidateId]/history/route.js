import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import {
  apiError,
  apiErrorFromResult,
  ERR,
} from '../../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import { correctTimeEmploymentHistory } from '../../../../../../../lib/people/time-clock-history-admin.js';
import { auditFromRequest } from '../../../../../../../lib/audit.js';
const schema = z.object({
  companyId: zPositiveInt.optional(),
  effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(10).max(500),
});
export const POST = withAdminApi(
  { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], companyFrom: 'body', body: schema },
  async ({ request, companyId, params, body, payload }) => {
    const candidateId = Number(params?.candidateId);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0)
      return apiError(request, ERR.INVALID_ID, 400);
    const result = await correctTimeEmploymentHistory({
      ...body,
      companyId,
      candidateId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId,
      companyId,
      action: 'time_clock.employment_history_correct',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: {
        effectiveOn: body.effectiveOn,
        startDate: body.startDate,
        reason: body.reason,
      },
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
