import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { getUpcomingAnniversaries } from '../../../../lib/people/upcoming-anniversaries.js';

/**
 * GET /api/admin/upcoming-anniversaries?companyId=&daysAhead=
 * Birthdays + work anniversaries (start_date) for Overview card (B-2300).
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.OVERVIEW_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
  },
  async ({ companyId, query }) => {
    const daysRaw = parseInt(String(query?.daysAhead || '14'), 10);
    const daysAhead = Number.isFinite(daysRaw) ? daysRaw : 14;
    const result = await getUpcomingAnniversaries(null, {
      companyId: Number(companyId),
      daysAhead,
    });
    if (!result.ok) {
      return NextResponse.json({ errorCode: result.errorCode || 'INTERNAL' }, { status: 400 });
    }
    return NextResponse.json(result);
  }
);
