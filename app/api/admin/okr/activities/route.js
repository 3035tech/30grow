/**
 * POST /api/admin/okr/activities — create activity under an area
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { createOkrActivity, OKR_WEIGHT_MAX, OKR_WEIGHT_MIN } from '../../../../../lib/development/okr-cycles.js';

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  areaId: zPositiveInt,
  title: z.string().trim().min(1).max(300),
  progressPct: z.coerce.number().int().min(0).max(100).optional(),
  weight: z.coerce.number().int().min(OKR_WEIGHT_MIN).max(OKR_WEIGHT_MAX).optional(),
  deadline: z.string().min(8).max(10).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'okr activities POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createOkrActivity(null, {
      companyId,
      areaId: body.areaId,
      title: body.title,
      progressPct: body.progressPct,
      weight: body.weight,
      deadline: body.deadline,
      sortOrder: body.sortOrder,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.activity_create',
      companyId,
      targetType: 'okr_activity',
      targetId: result.activity.id,
      metadata: { areaId: body.areaId, title: result.activity.title },
    });
    return NextResponse.json(result);
  }
);
