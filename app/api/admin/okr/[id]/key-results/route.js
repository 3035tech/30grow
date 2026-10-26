/**
 * POST /api/admin/okr/[id]/key-results — create key result under objective
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { createOkrKeyResult } from '../../../../../../lib/development/okr.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300),
  unit: z.string().max(40).optional(),
  targetValue: z.coerce.number().optional(),
  currentValue: z.coerce.number().optional(),
  performanceGoalId: zPositiveInt.optional().nullable(),
  sortOrder: z.coerce.number().int().optional(),
});

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** POST create KR */
export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'okr key-results POST',
  },
  async ({ request, companyId, body, payload, params }) => {
    const objectiveId = parseId(params);
    if (!objectiveId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await createOkrKeyResult(null, {
      companyId,
      objectiveId,
      title: body.title,
      unit: body.unit,
      targetValue: body.targetValue,
      currentValue: body.currentValue,
      performanceGoalId: body.performanceGoalId,
      sortOrder: body.sortOrder,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.key_result_create',
      companyId,
      targetType: 'okr_key_result',
      targetId: result.keyResult.id,
      metadata: { objectiveId, title: result.keyResult.title },
    });
    return NextResponse.json(result);
  }
);
