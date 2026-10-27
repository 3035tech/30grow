import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { query } from '../../../../../../lib/db.js';
import { CAP } from '../../../../../../lib/identity/permissions.js';
import { exportLeaveRequestsCsv } from '../../../../../../lib/people/employee-dp.js';

/** GET /api/admin/dp/leave/export — CSV of leave inbox (filters via query) */
export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'dp-leave-export',
  },
  async ({ query: q, companyId }) => {
    const data = await exportLeaveRequestsCsv(
      { query },
      {
        companyId,
        status: q.status,
        leaveType: q.leaveType,
        q: q.q,
        from: q.from,
        to: q.to,
      }
    );
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(data.csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dp-leave_${stamp}.csv"`,
        'X-Export-Count': String(data.count),
        'X-Export-Truncated': data.truncated ? '1' : '0',
      },
    });
  }
);
