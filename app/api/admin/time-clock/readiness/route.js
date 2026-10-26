import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { getTimeClosingReadiness } from '../../../../../lib/people/time-clock-readiness.js';
const schema = z.object({
  companyId: zPositiveInt.optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orgUnitId: zPositiveInt.optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(25),
});
export const GET = withAdminApi(
  { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], companyFrom: 'query', query: schema },
  async ({ request, companyId, query }) => {
    const data = await getTimeClosingReadiness(null, { ...query, companyId });
    if (!data.ok)
      return apiErrorFromResult(request, data, {
        fallbackCode: ERR.INVALID_DATA,
      });
    const total = data.items.length;
    return NextResponse.json(
      {
        ...data,
        total,
        page: query.page,
        pageSize: query.pageSize,
        items: data.items.slice(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize,
        ),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  },
);
