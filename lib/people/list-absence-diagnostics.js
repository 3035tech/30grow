/**
 * B-2601 — Diagnóstico “por que não vejo X?” (Equipe, Banco de talentos, pipeline da vaga).
 * Read-only, tenant-scoped, capped. No LLM / no generated SQL.
 *
 * Pure helpers: list-absence-diagnostics-core.js (client-safe).
 * This file adds the Postgres lookup (server / API only).
 */

import { queryRead } from '../db.js';
import { ROSTER_SCOPE } from '../domain-status.js';
import { PIPELINE_STAGE_SET } from '../pipeline.js';
import {
  ABSENCE_DIAG_CAP,
  ABSENCE_DIAG_Q_MAX,
  ABSENCE_DIAG_Q_MIN,
  ABSENCE_LIST,
  ABSENCE_OTHER_VACANCY_CAP,
  buildAbsenceDiagnostics,
  buildListMembershipDiagnostics,
} from './list-absence-diagnostics-core.js';

export {
  ABSENCE_DIAG_CAP,
  ABSENCE_DIAG_Q_MIN,
  ABSENCE_DIAG_Q_MAX,
  ABSENCE_LIST,
  ABSENCE_LIST_SET,
  ABSENCE_REASON,
  ABSENCE_SUGGESTION,
  buildAbsenceDiagnostics,
  buildListMembershipDiagnostics,
  classifyRosterVisibility,
} from './list-absence-diagnostics-core.js';

/**
 * @param {object} opts
 * @param {number} opts.companyId
 * @param {string} opts.q
 * @param {string} [opts.rosterScope]
 * @param {string|null} [opts.listFilter]
 * @param {string|null} [opts.pipelineStage]
 * @param {number} [opts.limit]
 */
export async function diagnoseListAbsence({
  companyId,
  q,
  rosterScope = ROSTER_SCOPE.INTERNAL,
  listFilter = null,
  pipelineStage = null,
  limit = ABSENCE_DIAG_CAP,
}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return buildAbsenceDiagnostics({ q, rosterScope, listFilter, pipelineStage, rows: [] });
  }

  const needle = String(q || '').trim().slice(0, ABSENCE_DIAG_Q_MAX);
  if (needle.length < ABSENCE_DIAG_Q_MIN) {
    return buildAbsenceDiagnostics({ q: needle, rosterScope, listFilter, pipelineStage, rows: [] });
  }

  const cap = Math.min(Math.max(1, Number(limit) || ABSENCE_DIAG_CAP), ABSENCE_DIAG_CAP);
  const like = `%${needle}%`;

  const res = await queryRead(
    `SELECT c.id,
            c.full_name AS "fullName",
            c.email,
            c.employment_status AS "employmentStatus",
            EXISTS (
              SELECT 1 FROM assessments a
              WHERE a.candidate_id = c.id
                AND a.company_id = c.company_id
                AND a.vacancy_id IS NULL
            ) AS "hasCompanyAssessment",
            EXISTS (
              SELECT 1 FROM assessments a
              WHERE a.candidate_id = c.id
                AND a.company_id = c.company_id
                AND a.vacancy_id IS NOT NULL
            ) AS "hasVacancyAssessment",
            (
              SELECT a.id FROM assessments a
              WHERE a.candidate_id = c.id AND a.company_id = c.company_id
              ORDER BY a.created_at DESC NULLS LAST, a.id DESC
              LIMIT 1
            ) AS "latestAssessmentId"
     FROM candidates c
     WHERE c.company_id = $1
       AND (c.full_name ILIKE $2 OR (c.email IS NOT NULL AND c.email ILIKE $2))
     ORDER BY c.full_name ASC NULLS LAST, c.id ASC
     LIMIT $3`,
    [cid, like, cap]
  );

  const rows = (res.rows || []).map((r) => ({
    id: Number(r.id),
    fullName: r.fullName,
    email: r.email || null,
    employmentStatus: r.employmentStatus,
    hasCompanyAssessment: Boolean(r.hasCompanyAssessment),
    hasVacancyAssessment: Boolean(r.hasVacancyAssessment),
    latestAssessmentId: r.latestAssessmentId != null ? Number(r.latestAssessmentId) : null,
  }));

  return buildAbsenceDiagnostics({
    q: needle,
    rosterScope,
    listFilter,
    pipelineStage,
    rows,
  });
}

const positiveIdOrNull = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

function membershipRows(rows) {
  return (rows || []).map((r) => ({
    id: Number(r.id),
    fullName: r.fullName,
    email: r.email || null,
    inList: Boolean(r.inList),
    matchesFilters: r.matchesFilters == null ? undefined : Boolean(r.matchesFilters),
    stage: r.stage || null,
    otherVacancyTitles: Array.isArray(r.otherVacancyTitles) ? r.otherVacancyTitles.filter(Boolean) : [],
  }));
}

function searchNeedle(companyId, q) {
  const cid = positiveIdOrNull(companyId);
  const needle = String(q || '').trim().slice(0, ABSENCE_DIAG_Q_MAX);
  return { cid, needle, ok: cid != null && needle.length >= ABSENCE_DIAG_Q_MIN };
}

/**
 * Banco de talentos: lista = vínculo com alguma vaga (vacancy_candidates ou avaliação com vaga),
 * mesmos filtros de lib/talent-bank.js (vaga, etapa, perfil T1–T9).
 *
 * @param {{ companyId: number, q: string, vacancyId?: number|null, stage?: string|null, topType?: number|null }} opts
 */
export async function diagnoseTalentBankAbsence({ companyId, q, vacancyId = null, stage = null, topType = null }) {
  const { cid, needle, ok } = searchNeedle(companyId, q);
  const vid = positiveIdOrNull(vacancyId);
  const stageKey = stage && PIPELINE_STAGE_SET.has(String(stage)) ? String(stage) : null;
  const typeRaw = Number(topType);
  const type = Number.isInteger(typeRaw) && typeRaw >= 1 && typeRaw <= 9 ? typeRaw : null;
  const filtersActive = vid != null || stageKey != null || type != null;
  if (!ok) return buildListMembershipDiagnostics({ q: needle, list: ABSENCE_LIST.TALENT_BANK, filtersActive, rows: [] });

  const res = await queryRead(
    `SELECT c.id,
            c.full_name AS "fullName",
            c.email,
            (
              EXISTS (SELECT 1 FROM vacancy_candidates vc
                      WHERE vc.candidate_id = c.id AND vc.company_id = c.company_id)
              OR EXISTS (SELECT 1 FROM assessments a
                         WHERE a.candidate_id = c.id AND a.company_id = c.company_id
                           AND a.vacancy_id IS NOT NULL)
            ) AS "inList",
            (
              (
                EXISTS (SELECT 1 FROM vacancy_candidates vc
                        WHERE vc.candidate_id = c.id AND vc.company_id = c.company_id
                          AND ($4::int IS NULL OR vc.vacancy_id = $4)
                          AND ($5::text IS NULL OR vc.pipeline_stage = $5))
                OR EXISTS (SELECT 1 FROM assessments a
                           WHERE a.candidate_id = c.id AND a.company_id = c.company_id
                             AND a.vacancy_id IS NOT NULL
                             AND ($4::int IS NULL OR a.vacancy_id = $4)
                             AND ($5::text IS NULL OR a.pipeline_stage = $5))
              )
              AND (
                $6::int IS NULL
                OR (SELECT a.top_type FROM assessments a
                    WHERE a.candidate_id = c.id AND a.company_id = c.company_id AND a.top_type IS NOT NULL
                    ORDER BY a.created_at DESC NULLS LAST, a.id DESC
                    LIMIT 1) = $6
              )
            ) AS "matchesFilters"
     FROM candidates c
     WHERE c.company_id = $1
       AND (c.full_name ILIKE $2 OR (c.email IS NOT NULL AND c.email ILIKE $2))
     ORDER BY c.full_name ASC NULLS LAST, c.id ASC
     LIMIT $3`,
    [cid, `%${needle}%`, ABSENCE_DIAG_CAP, vid, stageKey, type]
  );

  return buildListMembershipDiagnostics({
    q: needle,
    list: ABSENCE_LIST.TALENT_BANK,
    filtersActive: false,
    rows: membershipRows(res.rows),
  });
}

/**
 * Pipeline da vaga: lista = mesmas regras de lib/vacancy-ranking.js (avaliação da vaga, ou vínculo
 * com etapa / convite não cancelado). Filtros do quadro são do cliente (`filtersActive`).
 *
 * @param {{ companyId: number, q: string, vacancyId: number, filtersActive?: boolean }} opts
 */
export async function diagnoseVacancyPipelineAbsence({ companyId, q, vacancyId, filtersActive = false }) {
  const { cid, needle, ok } = searchNeedle(companyId, q);
  const vid = positiveIdOrNull(vacancyId);
  const active = Boolean(filtersActive);
  if (!ok || vid == null) {
    return buildListMembershipDiagnostics({ q: needle, list: ABSENCE_LIST.VACANCY_PIPELINE, filtersActive: active, rows: [] });
  }

  const res = await queryRead(
    `SELECT c.id,
            c.full_name AS "fullName",
            c.email,
            (
              EXISTS (SELECT 1 FROM assessments a
                      WHERE a.candidate_id = c.id AND a.company_id = c.company_id AND a.vacancy_id = $4)
              OR EXISTS (
                SELECT 1 FROM vacancy_candidates vc
                WHERE vc.candidate_id = c.id AND vc.company_id = c.company_id AND vc.vacancy_id = $4
                  AND (
                    vc.pipeline_stage IS NOT NULL
                    OR EXISTS (
                      SELECT 1 FROM candidate_invites ci
                      WHERE ci.vacancy_id = vc.vacancy_id
                        AND ci.status <> 'cancelled'
                        AND (ci.candidate_id = c.id
                             OR (c.email IS NOT NULL AND LOWER(ci.candidate_email) = LOWER(c.email)))
                    )
                  )
              )
            ) AS "inList",
            COALESCE(
              (SELECT a.pipeline_stage FROM assessments a
               WHERE a.candidate_id = c.id AND a.company_id = c.company_id AND a.vacancy_id = $4
               ORDER BY a.created_at DESC NULLS LAST, a.id DESC
               LIMIT 1),
              (SELECT vc.pipeline_stage FROM vacancy_candidates vc
               WHERE vc.candidate_id = c.id AND vc.company_id = c.company_id AND vc.vacancy_id = $4
               LIMIT 1)
            ) AS stage,
            ARRAY(
              SELECT DISTINCT v.title
              FROM (
                SELECT vc.vacancy_id FROM vacancy_candidates vc
                WHERE vc.candidate_id = c.id AND vc.company_id = c.company_id
                UNION
                SELECT a.vacancy_id FROM assessments a
                WHERE a.candidate_id = c.id AND a.company_id = c.company_id AND a.vacancy_id IS NOT NULL
              ) link
              JOIN vacancies v ON v.id = link.vacancy_id AND v.company_id = c.company_id AND v.deleted = FALSE
              WHERE link.vacancy_id <> $4
              ORDER BY v.title
              LIMIT ${ABSENCE_OTHER_VACANCY_CAP}
            ) AS "otherVacancyTitles"
     FROM candidates c
     WHERE c.company_id = $1
       AND (c.full_name ILIKE $2 OR (c.email IS NOT NULL AND c.email ILIKE $2))
     ORDER BY c.full_name ASC NULLS LAST, c.id ASC
     LIMIT $3`,
    [cid, `%${needle}%`, ABSENCE_DIAG_CAP, vid]
  );

  return buildListMembershipDiagnostics({
    q: needle,
    list: ABSENCE_LIST.VACANCY_PIPELINE,
    filtersActive: active,
    rows: membershipRows(res.rows),
  });
}
