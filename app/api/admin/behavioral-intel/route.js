import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db.js';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { normalizeLocale } from '../../../../lib/i18n.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { loadTeamBehavioralIntel } from '../../../../lib/people/load-team-behavioral-intel.js';
import { ROSTER_SCOPE, ROSTER_SCOPE_SET } from '../../../../lib/domain-status.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  teamGroupId: zPositiveInt.optional().nullable(),
  area: z.string().max(120).optional(),
  vacancy: z.string().max(40).optional(),
  dateFrom: z.string().max(32).optional(),
  dateTo: z.string().max(32).optional(),
  search: z.string().max(200).optional(),
  roster: z.string().max(32).optional(),
});

/**
 * GET /api/admin/behavioral-intel
 * Cohort for Overview BCI (client refresh on group select without full page nav).
 */
export const GET = withAdminApi(
  {
    anyCap: [CAP.OVERVIEW_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'behavioral-intel',
  },
  async ({ payload, companyId, scope, query }) => {
    const locale = normalizeLocale(payload?.locale || 'pt-BR');
    const cid = Number(companyId);
    const rosterRaw = String(query.roster || ROSTER_SCOPE.INTERNAL);
    const rosterScope = ROSTER_SCOPE_SET.has(rosterRaw) ? rosterRaw : ROSTER_SCOPE.INTERNAL;

    const intel = await loadTeamBehavioralIntel(
      { queryRead },
      {
        isAdmin: Boolean(scope.isAdmin),
        companyId: scope.isAdmin ? cid : cid,
        scopeCompanyFilter: cid,
        selectedArea: query.area && query.area !== 'all' ? query.area : 'all',
        selectedVacancy: query.vacancy && query.vacancy !== 'all' ? query.vacancy : 'all',
        enneagram: 'all',
        dateFrom: query.dateFrom || null,
        dateTo: query.dateTo || null,
        nameSearch: query.search || '',
        rosterScope,
        locale,
        teamGroupId: query.teamGroupId != null ? Number(query.teamGroupId) : null,
      }
    );

    return NextResponse.json({ ok: true, intel });
  }
);
