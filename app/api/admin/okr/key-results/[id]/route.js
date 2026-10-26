/**
 * PATCH /api/admin/okr/key-results/[id] — update KR progress
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import { updateOkrKeyResultProgress } from '../../../../../../lib/development/okr.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  currentValue: z.coerce.number().optional(),
  targetValue: z.coerce.number().optional(),
});

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** PATCH update current/target value */
export const PATCH = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'okr key-results PATCH',
  },
  async ({ request, companyId, body, payload, params }) => {
    const keyResultId = parseId(params);
    if (!keyResultId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    if (body.currentValue === undefined && body.targetValue === undefined) {
      return apiError(request, ERR.INVALID_DATA, httpStatusForError(ERR.INVALID_DATA));
    }
    const result = await updateOkrKeyResultProgress(null, {
      companyId,
      keyResultId,
      currentValue: body.currentValue,
      targetValue: body.targetValue,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.key_result_progress',
      companyId,
      targetType: 'okr_key_result',
      targetId: keyResultId,
      metadata: {
        currentValue: result.keyResult.currentValue,
        targetValue: result.keyResult.targetValue,
      },
    });
    return NextResponse.json(result);
  }
);
