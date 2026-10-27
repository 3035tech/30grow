/**
 * GET /api/admin/time-clock/people — paginated employees for the manager time clock.
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { ORG_UNIT } from '../../../../../lib/org-unit-constants.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { listTimeClockPeople } from '../../../../../lib/people/time-clock-manager.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  q: z.string().max(80).optional(),
  orgUnit: z.union([z.literal(ORG_UNIT.FILTER_NONE), zPositiveInt]).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'time-clock-people',
  },
  async ({ request, companyId, query }) => {
    const result = await listTimeClockPeople(null, {
      companyId,
      q: query.q || '',
      orgUnit: query.orgUnit ?? null,
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
    }
    return NextResponse.json(result);
  }
);
