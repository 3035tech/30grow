import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP, EMPLOYEE_SEARCH_CAPS } from '../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { searchCompanyEmployees } from '../../../../../lib/people/search-employees.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  q: z.string().trim().max(80).optional().default(''),
  limit: z.coerce.number().int().min(1).max(20).optional().default(20),
});

/**
 * GET /api/admin/employees/search?q= — typeahead de colaboradores ativos
 * Depth: app/api/admin/employees/search → 5× ../ até lib/
 */
export const GET = withAdminApi(
  {
    anyCap: [...EMPLOYEE_SEARCH_CAPS],
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'employees/search GET',
  },
  async ({ companyId, query }) => {
    const items = await searchCompanyEmployees(null, {
      companyId,
      q: query.q,
      limit: query.limit,
    });
    return NextResponse.json({ ok: true, items }, { status: 200 });
  }
);
