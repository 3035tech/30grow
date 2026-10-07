/**
 * GET /api/admin/field/expenses — reimbursement queue (paginated, with total amount).
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/permissions.js';
import { FIELD_EXPENSE_STATUSES } from '../../../../../lib/domain-status.js';
import { listFieldExpenses } from '../../../../../lib/people/field-team.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  status: z.enum(/** @type {[string, ...string[]]} */ ([...FIELD_EXPENSE_STATUSES, 'all'])).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'field-expenses',
  },
  async ({ request, companyId, query }) => {
    const result = await listFieldExpenses(null, {
      companyId,
      status: query.status === 'all' ? null : (query.status || undefined),
      q: query.q || '',
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);
