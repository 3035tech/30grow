import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db.js';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { normalizeLocale } from '../../../../lib/i18n.js';
import { buildMultiSignalWorkbench } from '../../../../lib/people/multi-signal-workbench.js';
import { getCompanyClimatePulse } from '../../../../lib/people/climate-surveys.js';
import { getCompanyPdiPulse } from '../../../../lib/people/development-plans.js';
import { getCompanyHrScoreRollup } from '../../../../lib/assessment/hr-score.js';
import { getCompanyTurnoverRisks } from '../../../../lib/turnover-radar.js';
import { listCompanyRetentionWatches } from '../../../../lib/people/retention-watch.js';
import { loadTeamBehavioralIntel } from '../../../../lib/people/load-team-behavioral-intel.js';

/**
 * GET /api/admin/multi-signal-workbench
 * Padrões multi-sinal para Overview (B-1903).
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.OVERVIEW_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
  },
  async ({ payload, companyId, scope }) => {
    const locale = normalizeLocale(payload?.locale || 'pt-BR');
    const cid = Number(companyId);

    const [climate, pdi, hrRollup, risks, watches, intel] = await Promise.all([
      getCompanyClimatePulse(queryRead, { companyId: cid }),
      getCompanyPdiPulse(queryRead, { companyId: cid }),
      getCompanyHrScoreRollup(cid),
      getCompanyTurnoverRisks(cid, { limit: 50, minRisk: 'medium' }),
      listCompanyRetentionWatches(queryRead, { companyId: cid, limit: 50 }).catch(() => ({
        items: [],
      })),
      loadTeamBehavioralIntel(
        { queryRead },
        {
          isAdmin: scope.isAdmin,
          companyId: cid,
          scopeCompanyFilter: cid,
          locale,
          rosterScope: 'internal',
        }
      ),
    ]);

    const riskList = Array.isArray(risks?.risks) ? risks.risks : Array.isArray(risks) ? risks : [];
    const retentionCount = Array.isArray(watches?.items)
      ? watches.items.length
      : Array.isArray(watches)
        ? watches.length
        : 0;

    const workbench = buildMultiSignalWorkbench({
      climate,
      pdi,
      retentionCount,
      intel,
      hr: hrRollup?.ok
        ? { avgScore: hrRollup.overall?.avgScore, total: hrRollup.overall?.total }
        : null,
      turnover: {
        highCount: riskList.filter((r) => r.risk === 'high').length,
        mediumCount: riskList.filter((r) => r.risk === 'medium').length,
      },
    });

    return NextResponse.json({ ok: true, workbench });
  }
);
