import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db.js';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { loadNineBoxForCompany } from '../../../../lib/people/nine-box.js';
import { apiErrorFromResult } from '../../../../lib/api-error.js';

/**
 * GET /api/admin/nine-box — 9Box grid (performance × potential), company-scoped.
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.PERFORMANCE_VIEW, CAP.TEAM_VIEW, CAP.SUCCESSION_VIEW],
    requireCompany: true,
    companyFrom: 'query',
  },
  async ({ request, companyId }) => {
    const result = await loadNineBoxForCompany(queryRead, { companyId: Number(companyId) });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);
