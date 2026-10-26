/**
 * GET /api/admin/compensation/proposed — company inbox of proposed variable pay.
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { listProposedVariablePay } from '../../../../../lib/people/variable-pay.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional(),
});

export const GET = withAdminApi(
  {
    cap: CAP.COMPENSATION_VIEW,
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'compensation-proposed',
  },
  async ({ request, companyId, query }) => {
    const result = await listProposedVariablePay(null, {
      companyId,
      limit: query.limit,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);
