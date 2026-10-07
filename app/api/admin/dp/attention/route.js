import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { query } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/permissions.js';
import { getAbsenteeismPulse, getDpAttentionPulse } from '../../../../../lib/people/employee-dp.js';
import { DP_LEAVE_STATUS } from '../../../../../lib/domain-status.js';
import { countPendingTimeRequests } from '../../../../../lib/people/time-clock-requests.js';
import { countPendingFieldExpenses } from '../../../../../lib/people/field-team.js';

/** GET /api/admin/dp/attention — pending docs + leave + absenteeism + time requests + reimbursements for inbox chips. */
export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'dp-attention',
  },
  async ({ companyId }) => {
    const [pulse, absenteeism, pendingTimeRequests, pendingFieldExpenses] = await Promise.all([
      getDpAttentionPulse({ query }, { companyId, cap: 20 }),
      getAbsenteeismPulse({ query }, { companyId, cap: 20 }),
      countPendingTimeRequests({ query }, { companyId }),
      countPendingFieldExpenses({ query }, { companyId }),
    ]);
    return NextResponse.json({
      ok: true,
      pendingDocsPeople: (pulse.pendingDocs || []).length,
      requestedLeaves: (pulse.leaves || []).filter(
        (l) => l.status === DP_LEAVE_STATUS.REQUESTED
      ).length,
      absenteeismPeople: (absenteeism.items || []).length,
      pendingTimeRequests,
      pendingFieldExpenses,
      absenteeismLookbackDays: absenteeism.lookbackDays || 90,
      absenteeism: absenteeism.items || [],
      pendingDocs: pulse.pendingDocs || [],
      leaves: pulse.leaves || [],
    });
  }
);
