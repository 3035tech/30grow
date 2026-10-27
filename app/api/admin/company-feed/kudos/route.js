import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { listCompanyKudos } from '../../../../../lib/company/company-kudos.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

/** GET /api/admin/company-feed/kudos — moderate recent recognition */
export const GET = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'company-feed kudos GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listCompanyKudos(null, {
      companyId,
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    }
    return NextResponse.json(result);
  }
);
