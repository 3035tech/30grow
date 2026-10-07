/**
 * POST /api/admin/field/expenses/[id] — approve | reject a reimbursement (optional note).
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { CAP } from '../../../../../../lib/permissions.js';
import { decideFieldExpenseWithNotice, fieldDecisionBodySchema } from '../../../../../../lib/people/field-team-api.js';
import { zPositiveInt } from '../../../../../../lib/validate.js';

export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'body',
    body: fieldDecisionBodySchema,
    logLabel: 'field-expense-decide',
  },
  async ({ request, companyId, body, params, payload }) => {
    const parsed = zPositiveInt.safeParse(params?.id);
    if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
    const result = await decideFieldExpenseWithNotice({
      companyId,
      userId: payload.userId || null,
      id: parsed.data,
      decision: body.decision,
      note: body.note || '',
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json({ ok: true, id: result.id, status: result.status });
  }
);
