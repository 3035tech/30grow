import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { query } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/permissions.js';
import { getAbsenteeismPulse, getDpAttentionPulse } from '../../../../../lib/people/employee-dp.js';
import { DP_LEAVE_STATUS } from '../../../../../lib/domain-status.js';
import { countPendingTimeRequests } from '../../../../../lib/people/time-clock-requests.js';
import { countPendingFieldExpenses } from '../../../../../lib/people/field-team.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';

async function readAttentionPart(part, load) {
  try {
    return await load();
  } catch (error) {
    // Identify the failing source without logging SQL, parameters or personal data.
    console.error('[dp-attention]', { part, code: error?.code || 'UNKNOWN' });
    throw error;
  }
}

/** GET /api/admin/dp/attention — pending docs + leave + absenteeism + time requests + reimbursements for inbox chips. */
export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'dp-attention',
  },
  async ({ companyId, request }) => {
    try {
      const [pulse, absenteeism, pendingTimeRequests, pendingFieldExpenses] = await Promise.all([
        readAttentionPart('documents-and-leave', () => getDpAttentionPulse({ query }, { companyId, cap: 20 })),
        readAttentionPart('absenteeism', () => getAbsenteeismPulse({ query }, { companyId, cap: 20 })),
        readAttentionPart('time-requests', () => countPendingTimeRequests({ query }, { companyId })),
        readAttentionPart('field-expenses', () => countPendingFieldExpenses({ query }, { companyId })),
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
    } catch (error) {
      const missingSchema = error?.code === '42P01' || error?.code === '42703';
      return apiError(request, missingSchema ? ERR.SCHEMA_NOT_INITIALIZED : ERR.INTERNAL,
        missingSchema ? 503 : 500, {}, { headers: { 'Cache-Control': 'no-store' } });
    }
  }
);
