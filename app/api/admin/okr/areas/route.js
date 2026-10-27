/**
 * POST /api/admin/okr/areas — create area under a cycle
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { createOkrArea } from '../../../../../lib/development/okr-cycles.js';

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  cycleId: zPositiveInt,
  title: z.string().trim().min(1).max(200),
  teamGroupId: zPositiveInt.optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'okr areas POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = await createOkrArea(null, {
      companyId,
      cycleId: body.cycleId,
      title: body.title,
      teamGroupId: body.teamGroupId,
      sortOrder: body.sortOrder,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.area_create',
      companyId,
      targetType: 'okr_area',
      targetId: result.area.id,
      metadata: { cycleId: body.cycleId, title: result.area.title },
    });
    return NextResponse.json(result);
  }
);
