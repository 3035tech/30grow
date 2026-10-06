import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { CAP, requireCapability } from '../../../../lib/permissions.js';
import { ROSTER_SCOPE, ROSTER_SCOPE_SET } from '../../../../lib/domain-status.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { audit, auditRequestContext } from '../../../../lib/audit.js';
import {
  ABSENCE_DIAG_Q_MAX,
  ABSENCE_LIST,
  ABSENCE_LIST_SET,
  diagnoseListAbsence,
  diagnoseTalentBankAbsence,
  diagnoseVacancyPipelineAbsence,
} from '../../../../lib/people/list-absence-diagnostics.js';

const bodySchema = z.object({
  q: z.string().trim().min(1).max(ABSENCE_DIAG_Q_MAX),
  roster: z.string().trim().max(32).optional(),
  listFilter: z.string().trim().max(64).nullable().optional(),
  pipeline: z.string().trim().max(32).nullable().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  list: z.string().trim().max(32).optional(),
  vacancyId: z.coerce.number().int().positive().nullable().optional(),
  topType: z.coerce.number().int().min(1).max(9).nullable().optional(),
  filtersActive: z.boolean().optional(),
});

const LIST_CAP = {
  [ABSENCE_LIST.TEAM]: CAP.TEAM_VIEW,
  [ABSENCE_LIST.TALENT_BANK]: CAP.VACANCIES_VIEW,
  [ABSENCE_LIST.VACANCY_PIPELINE]: CAP.VACANCIES_VIEW,
};

/**
 * POST /api/admin/help-diagnose
 * B-2601: why a person may be missing from Equipe, Banco de talentos or a vacancy pipeline (`list`).
 * Depth: app/api/admin/help-diagnose → 4× ../ até lib/
 */
export const POST = withAdminApi(
  {
    anyCap: [CAP.TEAM_VIEW, CAP.VACANCIES_VIEW],
    body: bodySchema,
    requireCompany: true,
    companyFrom: 'body',
    logLabel: 'help-diagnose POST',
  },
  async ({ request, payload, companyId, body }) => {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `help-diagnose:${payload.userId || ip}`,
      30,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const list = ABSENCE_LIST_SET.has(body.list) ? body.list : ABSENCE_LIST.TEAM;
    if (!requireCapability(payload, LIST_CAP[list])) {
      return apiError(request, ERR.FORBIDDEN, 403);
    }
    if (list === ABSENCE_LIST.VACANCY_PIPELINE && !body.vacancyId) {
      return apiError(request, ERR.INVALID_VACANCY, 400);
    }

    const rosterRaw = String(body.roster || ROSTER_SCOPE.INTERNAL).trim();
    const rosterScope = ROSTER_SCOPE_SET.has(rosterRaw) ? rosterRaw : ROSTER_SCOPE.INTERNAL;

    let result;
    if (list === ABSENCE_LIST.TALENT_BANK) {
      result = await diagnoseTalentBankAbsence({
        companyId,
        q: body.q,
        vacancyId: body.vacancyId ?? null,
        stage: body.pipeline || null,
        topType: body.topType ?? null,
      });
    } else if (list === ABSENCE_LIST.VACANCY_PIPELINE) {
      result = await diagnoseVacancyPipelineAbsence({
        companyId,
        q: body.q,
        vacancyId: body.vacancyId,
        filtersActive: body.filtersActive === true,
      });
    } else {
      result = await diagnoseListAbsence({
        companyId,
        q: body.q,
        rosterScope,
        listFilter: body.listFilter || null,
        pipelineStage: body.pipeline || null,
      });
    }

    await audit({
      actorUserId: payload.userId ?? null,
      companyId,
      action: 'help.diagnose_absence',
      targetType: 'company',
      targetId: companyId,
      metadata: {
        qLen: String(body.q || '').length,
        list,
        roster: list === ABSENCE_LIST.TEAM ? rosterScope : null,
        vacancyId: body.vacancyId ?? null,
        reasonCodes: (result.reasons || []).map((r) => r.code),
        candidateCount: (result.candidates || []).length,
      },
      ...auditRequestContext(request),
    });

    return NextResponse.json(
      {
        ok: true,
        reasons: result.reasons,
        suggestions: result.suggestions,
        candidates: result.candidates,
        query: result.query,
        roster: result.roster ?? null,
        list,
      },
      { status: 200 }
    );
  }
);
