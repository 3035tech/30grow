/**
 * PATCH  /api/admin/okr/activities/[id] — update progress / title / deadline
 * DELETE /api/admin/okr/activities/[id]
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { deleteOkrActivity, updateOkrActivity, OKR_WEIGHT_MAX, OKR_WEIGHT_MIN } from '../../../../../../lib/development/okr-cycles.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300).optional(),
  progressPct: z.coerce.number().int().min(0).max(100).optional(),
  weight: z.coerce.number().int().min(OKR_WEIGHT_MIN).max(OKR_WEIGHT_MAX).optional(),
  deadline: z.string().min(8).max(10).optional().nullable(),
});

export const PATCH = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'okr activities PATCH',
  },
  async ({ request, companyId, body, payload, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await updateOkrActivity(null, {
      companyId,
      activityId,
      title: body.title,
      progressPct: body.progressPct,
      weight: body.weight,
      deadline: body.deadline,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.activity_update',
      companyId,
      targetType: 'okr_activity',
      targetId: activityId,
      metadata: { progressPct: result.activity.progressPct, weight: result.activity.weight },
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    companyFrom: 'query',
    query: z.object({ companyId: zPositiveInt.optional() }),
    logLabel: 'okr activities DELETE',
  },
  async ({ request, companyId, payload, params }) => {
    const activityId = Number(params?.id);
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await deleteOkrActivity(null, { companyId, activityId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.activity_delete',
      companyId,
      targetType: 'okr_activity',
      targetId: activityId,
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  }
);
