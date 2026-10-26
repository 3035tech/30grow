/**
 * DELETE /api/admin/okr/[id] — delete objective (cascades KRs)
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { audit } from '../../../../../lib/audit.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { deleteOkrObjective } from '../../../../../lib/development/okr.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
});

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** DELETE objective */
export const DELETE = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'okr DELETE',
  },
  async ({ request, companyId, payload, params }) => {
    const objectiveId = parseId(params);
    if (!objectiveId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await deleteOkrObjective(null, { companyId, objectiveId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'okr.objective_delete',
      companyId,
      targetType: 'okr_objective',
      targetId: objectiveId,
    });
    return NextResponse.json({ ok: true });
  }
);
