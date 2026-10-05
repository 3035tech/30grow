import { NextResponse } from 'next/server';
import { z } from 'zod';
import { queryRead } from '../../../../../lib/db.js';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/permissions.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import { buildPersonDossier } from '../../../../../lib/people/person-dossier.js';
import { buildTeamTensionNarrative } from '../../../../../lib/people/team-tension-narrative.js';
import { loadTeamBehavioralIntel } from '../../../../../lib/people/load-team-behavioral-intel.js';
import { interpretPeopleSignalsAi } from '../../../../../lib/people/interpret-ai.js';
import { buildMultiSignalWorkbench } from '../../../../../lib/people/multi-signal-workbench.js';
import { getCompanyClimatePulse } from '../../../../../lib/people/climate-surveys.js';
import { getCompanyPdiPulse } from '../../../../../lib/people/development-plans.js';
import { getCompanyHrScoreRollup } from '../../../../../lib/hr-score.js';
import { getCompanyTurnoverRisks } from '../../../../../lib/turnover-radar.js';
import { listCompanyRetentionWatches } from '../../../../../lib/people/retention-watch.js';

const bodySchema = z.object({
  kind: z.enum(['person', 'team', 'workbench']),
  locale: z.string().optional(),
  candidateId: z.coerce.number().int().positive().optional(),
  teamGroupId: z.coerce.number().int().positive().nullable().optional(),
  companyId: z.coerce.number().int().positive().optional(),
});

async function loadIntel(scope, companyId, locale, teamGroupId) {
  return loadTeamBehavioralIntel(
    { queryRead },
    {
      isAdmin: scope.isAdmin,
      companyId,
      scopeCompanyFilter: companyId,
      locale,
      teamGroupId: teamGroupId ?? null,
      rosterScope: 'internal',
    }
  );
}

function retentionCountFromWatches(watches) {
  if (Array.isArray(watches)) return watches.length;
  if (watches && Array.isArray(watches.items)) return watches.items.length;
  return 0;
}

/**
 * POST /api/admin/people/interpret-ai
 * IA interpretativa (B-1904) — person | team | workbench.
 */
export const POST = withAdminApi(
  {
    anyCap: [CAP.TEAM_VIEW, CAP.OVERVIEW_VIEW],
    body: bodySchema,
    requireCompany: true,
    companyFrom: 'body',
  },
  async ({ request, payload, companyId, body, scope }) => {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `people-interpret:${payload.userId || ip}`,
      20,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');
    const cid = Number(companyId);
    const usage = { companyId: cid, userId: payload.userId };

    if (body.kind === 'person') {
      const candidateId = Number(body.candidateId);
      if (!Number.isFinite(candidateId)) {
        return apiError(request, ERR.INVALID_PARAMS, 400);
      }
      const dossier = await buildPersonDossier(queryRead, {
        candidateId,
        companyId: cid,
        locale,
        isAdmin: scope.isAdmin,
      });
      if (!dossier.ok) {
        return apiErrorFromResult(request, dossier, { fallbackCode: ERR.NOT_FOUND });
      }
      const out = await interpretPeopleSignalsAi({
        kind: 'person',
        locale,
        usage,
        signals: {
          candidate: dossier.candidate,
          profile: dossier.profile,
          briefing: dossier.briefing,
          pdi: dossier.pdi,
          performance: dossier.performance,
          retention: dossier.retention,
          onboarding: dossier.onboarding,
          hrScore: dossier.hrScore,
          climateCompany: dossier.climateCompany,
        },
      });
      if (!out.ok) return apiErrorFromResult(request, out, { fallbackCode: ERR.RUBRIC_AI_FAILED });
      return NextResponse.json({ ok: true, kind: 'person', ...out });
    }

    if (body.kind === 'team') {
      const intel = await loadIntel(scope, cid, locale, body.teamGroupId);
      const narrative = buildTeamTensionNarrative(intel);
      const out = await interpretPeopleSignalsAi({
        kind: 'team',
        locale,
        usage,
        signals: {
          narrative,
          forces: (intel?.forces || []).slice(0, 5),
          attentions: (intel?.attentions || []).slice(0, 5),
          meta: intel?.meta || null,
          topMovers: (intel?.topMovers || []).slice(0, 5),
        },
      });
      if (!out.ok) return apiErrorFromResult(request, out, { fallbackCode: ERR.RUBRIC_AI_FAILED });
      return NextResponse.json({ ok: true, kind: 'team', narrative, ...out });
    }

    const [climate, pdi, hrRollup, risks, watches, intel] = await Promise.all([
      getCompanyClimatePulse(queryRead, { companyId: cid }),
      getCompanyPdiPulse(queryRead, { companyId: cid }),
      getCompanyHrScoreRollup(cid),
      getCompanyTurnoverRisks(cid, { limit: 50, minRisk: 'medium' }),
      listCompanyRetentionWatches(queryRead, { companyId: cid, limit: 50 }).catch(() => ({
        items: [],
      })),
      loadIntel(scope, cid, locale, null),
    ]);

    const riskList = Array.isArray(risks?.risks) ? risks.risks : Array.isArray(risks) ? risks : [];
    const workbench = buildMultiSignalWorkbench({
      climate,
      pdi,
      retentionCount: retentionCountFromWatches(watches),
      intel,
      hr: hrRollup?.ok
        ? { avgScore: hrRollup.overall?.avgScore, total: hrRollup.overall?.total }
        : null,
      turnover: {
        highCount: riskList.filter((r) => r.risk === 'high').length,
        mediumCount: riskList.filter((r) => r.risk === 'medium').length,
      },
    });

    const out = await interpretPeopleSignalsAi({
      kind: 'team',
      locale,
      usage,
      signals: { workbench, climate, pdiSummary: pdi, hr: hrRollup?.overall || null },
    });
    if (!out.ok) return apiErrorFromResult(request, out, { fallbackCode: ERR.RUBRIC_AI_FAILED });
    return NextResponse.json({ ok: true, kind: 'workbench', workbench, ...out });
  }
);
