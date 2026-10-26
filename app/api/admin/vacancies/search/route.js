import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { searchOpenVacancies } from '../../../../../lib/recruiting/vacancies-search.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  q: z.string().trim().max(80).optional().default(''),
  limit: z.coerce.number().int().min(1).max(20).optional().default(20),
});

/**
 * GET /api/admin/vacancies/search?q= — typeahead de vagas abertas da empresa
 * Depth: app/api/admin/vacancies/search → 5× ../ até lib/
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.VACANCIES_VIEW, CAP.TEAM_VIEW],
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'vacancies/search GET',
  },
  async ({ companyId, query }) => {
    const items = await searchOpenVacancies(null, {
      companyId,
      q: query.q,
      limit: query.limit,
    });
    return NextResponse.json({ ok: true, items }, { status: 200 });
  }
);
