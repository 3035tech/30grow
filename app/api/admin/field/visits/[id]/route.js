/**
 * DELETE /api/admin/field/visits/[id] — cancel a visit that has not started.
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../lib/permissions.js';
import { cancelPlannedFieldVisit } from '../../../../../../lib/people/field-team-api.js';
import { zPositiveInt } from '../../../../../../lib/validate.js';

export const DELETE = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'field-visit-cancel',
  },
  async ({ request, companyId, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    const result = await cancelPlannedFieldVisit({ companyId, userId: payload.userId || null, id: parsed.data });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, id: result.id });
  }
);
