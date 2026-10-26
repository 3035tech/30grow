import { oldestOverdueDays, organizeOverviewAttention } from './overview-attention.js';
import { rejectionReasonsSql } from '../recruiting/pipeline.js';
/**
 * Recruiter Overview metrics.
 * Funnel ignores the pipeline filter (full picture); company/area/vacancy/dates/search apply.
 */

import { queryRead } from '../db.js';
import {
  assessmentListWhereParts,
  candidateNameSearchClause,
  resolveCohortCompanyId,
  sqlWhere,
} from '../assessment/assessment-filters.js';
import { OVERVIEW_FUNNEL_STAGES } from './overview-constants.js';
import { PIPELINE_STAGE } from '../recruiting/pipeline.js';
import { canonicalStageJoinSql, canonicalStageExprSql } from '../company/company-pipeline-stages.js';
import { VACANCY_STATUS, DP_LEAVE_STATUS, OFFER_STATUS } from '../domain-status.js';
import { buildTypeMixCompositionAdvice, dominantFromTypeCount, buildTypeMixWindowDelta, buildMixVsRubricAdvice } from './overview-type-mix.js';
import { getCompanyPdiPulse } from '../people/development-plans.js';
import { getCompanyClimatePulse, getCompanyEnpsPulse } from '../people/climate-surveys.js';
import { getCompanyOnboardingPulse } from '../people/onboarding-checkins.js';
import { listCompanyRetentionWatches } from '../people/retention-watch.js';
import { loadTeamBehavioralIntel } from '../people/load-team-behavioral-intel.js';
import { getCompanyLmsOverduePulse } from '../development/lms.js';
import { getAbsenteeismPulse, getDpAttentionPulse } from '../people/employee-dp.js';
import { getCompensationMarketPulse } from '../people/employee-compensation.js';

export { buildTypeMixCompositionAdvice, buildTypeMixWindowDelta, buildMixVsRubricAdvice } from './overview-type-mix.js';

function companyParts(isAdmin, companyId, scopeCompanyFilter, alias) {
  const parts = [];
  const params = [];
  const effective = resolveCohortCompanyId({ isAdmin, companyId, scopeCompanyFilter });
  if (effective != null) {
    params.push(effective);
    parts.push(`${alias}.company_id = $${params.length}`);
  }
  return { parts, params };
}

function daysAgo(dateLike) {
  if (!dateLike) return null;
  const a = new Date(dateLike);
  if (Number.isNaN(a.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - a.getTime()) / 86400000));
}

function andWhere(baseWhere, extraSql) {
  if (!baseWhere) return `WHERE ${extraSql}`;
  return `${baseWhere} AND ${extraSql}`;
}

function emptyMetrics(typeCount = {}) {
  const typeMixTotal = Object.values(typeCount || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const advice = buildTypeMixCompositionAdvice(typeCount);
  return {
    funnel: Object.fromEntries(OVERVIEW_FUNNEL_STAGES.map((s) => [s, 0])),
    funnelTotal: 0,
    hiredLast7d: 0,
    rejectedLast7d: 0,
    rejectionReasons: [],
    rejectionPatterns: [],
    attention: [],
    vacancies: { openCount: 0, positionsOpen: 0, staleCount: 0, items: [] },
    typeMix: {
      typeCount: typeCount || {},
      total: typeMixTotal,
      dominantType: dominantFromTypeCount(typeCount),
      advice,
      windowDelta: null,
      rubricDelta: null,
    },
    behavioralIntel: null,
    peopleOps: null,
    error: false,
  };
}

/**
 * @param {object} ctx
 * @returns {Promise<object>}
 */
export async function buildOverviewMetrics(ctx) {
  const {
    isAdmin,
    companyId,
    scopeCompanyFilter,
    selectedArea = 'all',
    selectedVacancy = 'all',
    enneagram = 'all',
    dateFrom = null,
    dateTo = null,
    nameSearch = '',
    typeCount = {},
    rosterScope = 'internal',
    locale = 'pt-BR',
    teamGroupId = null,
  } = ctx;

  const base = emptyMetrics(typeCount);

  try {
    const { whereParts, params } = assessmentListWhereParts({
      isAdmin,
      companyId,
      scopeCompanyFilter,
      selectedArea,
      selectedVacancy,
      enneagram,
      pipelineStage: 'all',
      dateFrom,
      dateTo,
      rosterScope,
    });
    const funnelParts = nameSearch
      ? [...whereParts, candidateNameSearchClause('c', params.length + 1)]
      : whereParts;
    const funnelParams = nameSearch ? [...params, `%${nameSearch}%`] : params;
    const funnelWhere = sqlWhere(funnelParts);

    const vacRaw = String(selectedVacancy ?? 'all').trim();
    const vcScope = companyParts(isAdmin, companyId, scopeCompanyFilter, 'vc');
    const vcParts = [...vcScope.parts, 'v.deleted = FALSE', 'co.deleted = FALSE'];
    const vcParams = [...vcScope.params];
    if (vacRaw !== 'all') {
      const vid = parseInt(vacRaw, 10);
      if (Number.isFinite(vid)) {
        vcParams.push(vid);
        vcParts.push(`vc.vacancy_id = $${vcParams.length}`);
      }
    }
    if (nameSearch) {
      vcParams.push(`%${nameSearch}%`);
      vcParts.push(candidateNameSearchClause('c', vcParams.length));
    }

    const vacScope = companyParts(isAdmin, companyId, scopeCompanyFilter, 'v');
    const invScope = companyParts(isAdmin, companyId, scopeCompanyFilter, 'i');
    const invParts = [...invScope.parts, `i.status IN ('sent', 'opened')`, 'v.deleted = FALSE'];
    const invParams = [...invScope.params];
    if (vacRaw !== 'all') {
      const vid = parseInt(vacRaw, 10);
      if (Number.isFinite(vid)) {
        invParams.push(vid);
        invParts.push(`i.vacancy_id = $${invParams.length}`);
      }
    }

    const [
      funnelRes,
      pendingVc,
      hired7,
      rejected7,
      reasonsRes,
      rejectPatternsRes,
      staleInvites,
      nearVac,
      noNotes,
      stuck,
      waiting,
      openCountRes,
      vacList,
      noScorecard,
      hireGaps,
    ] = await Promise.all([
      queryRead(
        `SELECT COALESCE(${canonicalStageExprSql('ass')}, '${PIPELINE_STAGE.TEST_COMPLETED}') AS stage, COUNT(*)::int AS n
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         ${canonicalStageJoinSql('ass')}
         ${funnelWhere}
         GROUP BY 1`,
        funnelParams
      ),
      queryRead(
        `SELECT COUNT(*)::int AS n
         FROM vacancy_candidates vc
         JOIN candidates c ON c.id = vc.candidate_id
         JOIN vacancies v ON v.id = vc.vacancy_id
         JOIN companies co ON co.id = vc.company_id
         LEFT JOIN assessments ass
           ON ass.candidate_id = vc.candidate_id AND ass.vacancy_id = vc.vacancy_id
         WHERE ${vcParts.join(' AND ')} AND ass.id IS NULL`,
        vcParams
      ),
      queryRead(
        `SELECT COUNT(*)::int AS n
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         ${canonicalStageJoinSql('ass')}
         ${andWhere(funnelWhere, `${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.HIRED}' AND ass.hired_at >= NOW() - INTERVAL '7 days'`)}`,
        funnelParams
      ),
      queryRead(
        `SELECT COUNT(*)::int AS n
         FROM assessment_pipeline_history h
         JOIN assessments ass ON ass.id = h.assessment_id
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         LEFT JOIN company_pipeline_stages cps_h
           ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
         ${andWhere(funnelWhere, `COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.REJECTED}' AND h.changed_at >= NOW() - INTERVAL '7 days'`)}`,
        funnelParams
      ),
      queryRead(
        `SELECT selected_reason.reason AS reason, COUNT(*)::int AS n
         FROM assessment_pipeline_history h
         CROSS JOIN LATERAL unnest(CASE WHEN cardinality(${rejectionReasonsSql('h', 'reason')}) > 0
           THEN ${rejectionReasonsSql('h', 'reason')} ELSE ARRAY['other']::text[] END) AS selected_reason(reason)
         JOIN assessments ass ON ass.id = h.assessment_id
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         LEFT JOIN company_pipeline_stages cps_h
           ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
         ${andWhere(funnelWhere, `COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.REJECTED}' AND h.changed_at >= NOW() - INTERVAL '7 days'`)}
         GROUP BY 1
         ORDER BY n DESC
         LIMIT 6`,
        funnelParams
      ),
      queryRead(
        `SELECT selected_reason.reason AS reason,
                ass.top_type AS "topType",
                COUNT(*)::int AS n
         FROM assessment_pipeline_history h
         CROSS JOIN LATERAL unnest(CASE WHEN cardinality(${rejectionReasonsSql('h', 'reason')}) > 0
           THEN ${rejectionReasonsSql('h', 'reason')} ELSE ARRAY['other']::text[] END) AS selected_reason(reason)
         JOIN assessments ass ON ass.id = h.assessment_id
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         LEFT JOIN company_pipeline_stages cps_h
           ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
         ${andWhere(
           funnelWhere,
           `COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.REJECTED}'
            AND h.changed_at >= NOW() - INTERVAL '7 days'
            AND ass.top_type BETWEEN 1 AND 9`
         )}
         GROUP BY 1, 2
         ORDER BY n DESC
         LIMIT 6`,
        funnelParams
      ).catch(() => ({ rows: [] })),
      queryRead(
        `SELECT i.id, i.company_id AS "companyId", i.candidate_email AS "candidateEmail", i.vacancy_id AS "vacancyId", i.candidate_name AS name,
                v.title AS "vacancyTitle", i.sent_at AS "sentAt"
         FROM candidate_invites i
         JOIN vacancies v ON v.id = i.vacancy_id
         WHERE ${invParts.join(' AND ')}
           AND i.sent_at < NOW() - INTERVAL '2 days'
         ORDER BY i.sent_at DESC, i.id DESC
         LIMIT 30`,
        invParams
      ),
      queryRead(
        `SELECT v.id, v.title, v.target_date AS "targetDate", v.positions_count AS "positionsCount"
         FROM vacancies v
         JOIN companies co ON co.id = v.company_id
         WHERE ${[
           ...vacScope.parts,
           'v.deleted = FALSE',
           'co.deleted = FALSE',
           `v.status = '${VACANCY_STATUS.OPEN}'`,
           'v.target_date IS NOT NULL',
           "v.target_date <= (CURRENT_DATE + INTERVAL '7 days')",
         ].join(' AND ')}
         ORDER BY v.target_date ASC
         LIMIT 3`,
        vacScope.params
      ),
      queryRead(
        `SELECT vc.id, c.full_name AS name, v.id AS "vacancyId", v.title AS "vacancyTitle",
                vc.updated_at AS "updatedAt"
         FROM vacancy_candidates vc
         JOIN candidates c ON c.id = vc.candidate_id
         JOIN vacancies v ON v.id = vc.vacancy_id
         JOIN companies co ON co.id = vc.company_id
         WHERE ${vcParts.join(' AND ')}
           AND (
             vc.interview_notes IS NULL
             OR TRIM(regexp_replace(vc.interview_notes, '<[^>]*>', '', 'g')) = ''
           )
         ORDER BY vc.updated_at DESC
         LIMIT 2`,
        vcParams
      ),
      queryRead(
        `SELECT ass.id AS "assessmentId", c.full_name AS name, v.title AS "vacancyTitle",
                ass.created_at AS "since"
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         ${canonicalStageJoinSql('ass')}
         ${andWhere(
           funnelWhere,
           `${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.INTERVIEW}'
            AND ass.created_at < NOW() - INTERVAL '7 days'`
         )}
         ORDER BY ass.created_at ASC
         LIMIT 2`,
        funnelParams
      ),
      queryRead(
        `SELECT ass.id AS "assessmentId", c.full_name AS name, v.title AS "vacancyTitle",
                ass.created_at AS "createdAt"
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         ${canonicalStageJoinSql('ass')}
         ${andWhere(funnelWhere, `${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.TEST_COMPLETED}'`)}
         ORDER BY ass.created_at ASC
         LIMIT 2`,
        funnelParams
      ),
      queryRead(
        `SELECT COUNT(*)::int AS n
         FROM vacancies v
         JOIN companies co ON co.id = v.company_id
         WHERE ${[...vacScope.parts, 'v.deleted = FALSE', 'co.deleted = FALSE', `v.status = '${VACANCY_STATUS.OPEN}'`].join(' AND ')}`,
        vacScope.params
      ),
      queryRead(
        `SELECT
           v.id,
           v.title,
           v.positions_count AS "positionsCount",
           v.target_date AS "targetDate",
           0::int AS hired,
           0::int AS "inFunnel",
           0::int AS "approvedGaps",
           v.created_at AS "lastActivity"
         FROM vacancies v
         JOIN companies co ON co.id = v.company_id
         WHERE ${[...vacScope.parts, 'v.deleted = FALSE', 'co.deleted = FALSE', `v.status = '${VACANCY_STATUS.OPEN}'`].join(' AND ')}
         ORDER BY v.target_date ASC NULLS LAST, v.created_at DESC
         LIMIT 8`,
        vacScope.params
      ),
      queryRead(
        `SELECT ass.id AS "assessmentId", c.id AS "candidateId", c.full_name AS name,
                v.id AS "vacancyId", v.title AS "vacancyTitle",
                COALESCE(stage_enter.entered_at, ass.created_at) AS "since"
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE
         LEFT JOIN LATERAL (
           SELECT MAX(h.changed_at) AS entered_at
           FROM assessment_pipeline_history h
           LEFT JOIN company_pipeline_stages cps_h
             ON cps_h.company_id = ass.company_id AND cps_h.stage_key = h.to_stage AND cps_h.deleted_at IS NULL
           WHERE h.assessment_id = ass.id
             AND COALESCE(cps_h.canonical_key, h.to_stage) = '${PIPELINE_STAGE.INTERVIEW}'
         ) stage_enter ON TRUE
         LEFT JOIN interview_scorecards sc
           ON sc.vacancy_id = ass.vacancy_id AND sc.candidate_id = c.id
         ${canonicalStageJoinSql('ass')}
         ${andWhere(
           funnelWhere,
           `${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.INTERVIEW}'
            AND COALESCE(stage_enter.entered_at, ass.created_at) < NOW() - INTERVAL '7 days'
            AND (
              sc.id IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(sc.items, '[]'::jsonb)) it
                WHERE (it->>'rating') ~ '^[1-5]$'
              )
            )`
         )}
         ORDER BY "since" ASC
         LIMIT 3`,
        funnelParams
      ).catch(() => ({ rows: [] })),
      queryRead(
        `SELECT ass.id AS "assessmentId", c.id AS "candidateId", c.full_name AS name,
                v.id AS "vacancyId", v.title AS "vacancyTitle",
                ass.offer_status AS "offerStatus",
                EXISTS (
                  SELECT 1 FROM ae_attempts att
                  WHERE att.candidate_id = c.id AND att.status = 'completed'
                ) AS "hasMotivators"
         FROM assessments ass
         JOIN candidates c ON c.id = ass.candidate_id
         JOIN areas ar ON ar.id = ass.area_id
         JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE AND v.status = '${VACANCY_STATUS.OPEN}'
         ${canonicalStageJoinSql('ass')}
         ${andWhere(
           funnelWhere,
           `${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.APPROVED}'
            AND (
              COALESCE(ass.offer_status, '${OFFER_STATUS.NONE}') = '${OFFER_STATUS.NONE}'
              OR NOT EXISTS (
                SELECT 1 FROM ae_attempts att
                WHERE att.candidate_id = c.id AND att.status = 'completed'
              )
            )`
         )}
         ORDER BY ass.created_at DESC NULLS LAST, ass.id DESC
         LIMIT 4`,
        funnelParams
      ).catch(() => ({ rows: [] })),
    ]);

    const funnel = { ...base.funnel };
    let funnelTotal = 0;
    for (const row of funnelRes.rows) {
      if (!OVERVIEW_FUNNEL_STAGES.includes(row.stage)) continue;
      funnel[row.stage] = row.n;
      funnelTotal += row.n;
    }
    const pendingN = pendingVc.rows[0]?.n ?? 0;
    if (pendingN > 0) {
      funnel.new += pendingN;
      funnelTotal += pendingN;
    }

    const attention = [];
    for (const row of staleInvites.rows) {
      attention.push({
        id: `invite-${row.id}`,
        dedupeKey: row.candidateEmail ? `invite:${row.companyId}:${row.vacancyId}:${row.candidateEmail.toLowerCase().trim()}` : `invite-${row.id}`,
        priority: 'high',
        kind: 'invite_pending',
        titleKey: 'panel.overview.attnInvitePending',
        context: [row.name, row.vacancyTitle].filter(Boolean).join(' · '),
        days: daysAgo(row.sentAt) ?? 2,
        nav: { tab: 'vacancies', vacancyDetail: String(row.vacancyId) },
      });
    }
    for (const row of nearVac.rows) {
      const targetTime = row.targetDate
        ? new Date(`${String(row.targetDate).slice(0, 10)}T12:00:00`).getTime()
        : NaN;
      const daysLeft = Number.isFinite(targetTime)
        ? Math.ceil((targetTime - Date.now()) / 86400000)
        : null;
      attention.push({
        id: `target-${row.id}`,
        priority: 'high',
        kind: 'vacancy_target',
        titleKey: daysLeft != null && daysLeft < 0
          ? 'panel.overview.attnTargetOverdue'
          : 'panel.overview.attnTargetSoon',
        context: row.title,
        days: daysLeft == null ? null : Math.abs(daysLeft),
        daysUntil: daysLeft != null && daysLeft > 0,
        daysToday: daysLeft === 0,
        nav: { tab: 'vacancies', vacancyDetail: String(row.id) },
      });
    }
    for (const row of noNotes.rows) {
      attention.push({
        id: `notes-${row.id}`,
        priority: 'medium',
        kind: 'missing_notes',
        titleKey: 'panel.overview.attnMissingNotes',
        context: [row.name, row.vacancyTitle].filter(Boolean).join(' · '),
        days: daysAgo(row.updatedAt) ?? 0,
        nav: { tab: 'vacancies', vacancyDetail: String(row.vacancyId) },
      });
    }
    for (const row of stuck.rows) {
      attention.push({
        id: `stuck-${row.assessmentId}`,
        priority: 'medium',
        kind: 'stuck_interview',
        titleKey: 'panel.overview.attnStuckInterview',
        context: [row.name, row.vacancyTitle].filter(Boolean).join(' · '),
        days: daysAgo(row.since) ?? 7,
        nav: { tab: 'team', pipeline: 'interview', search: row.name },
      });
    }
    for (const row of waiting.rows) {
      attention.push({
        id: `wait-${row.assessmentId}`,
        priority: 'low',
        kind: 'awaiting_screening',
        titleKey: 'panel.overview.attnAwaitingScreening',
        context: [row.name, row.vacancyTitle].filter(Boolean).join(' · '),
        days: daysAgo(row.createdAt) ?? 0,
        nav: { tab: 'team', pipeline: 'test_completed', search: row.name },
      });
    }
    for (const row of noScorecard.rows || []) {
      attention.push({
        id: `scorecard-${row.assessmentId}`,
        priority: 'medium',
        kind: 'missing_scorecard',
        titleKey: 'panel.overview.attnMissingScorecard',
        context: [row.name, row.vacancyTitle].filter(Boolean).join(' · '),
        days: daysAgo(row.since) ?? 7,
        nav: row.vacancyId
          ? { tab: 'vacancies', vacancyDetail: String(row.vacancyId) }
          : { tab: 'team', pipeline: 'interview', search: row.name },
      });
    }
    for (const row of hireGaps.rows || []) {
      const gaps = [];
      if (!row.hasMotivators) gaps.push('Motivadores');
      if (String(row.offerStatus || OFFER_STATUS.NONE) === OFFER_STATUS.NONE) gaps.push('proposta');
      attention.push({
        id: `hiregap-${row.assessmentId}`,
        priority: 'high',
        kind: 'hire_readiness_gap',
        titleKey: 'panel.overview.attnHireReadinessGap',
        context: [row.name, row.vacancyTitle, gaps.join(' · ')].filter(Boolean).join(' · '),
        days: null,
        nav: row.vacancyId
          ? { tab: 'vacancies', vacancyDetail: String(row.vacancyId) }
          : { tab: 'team', pipeline: 'approved', search: row.name },
      });
    }

    const pulseCompanyId = !isAdmin ? companyId : scopeCompanyFilter;
    let retentionWatch = { items: [], minScore: null };
    if (pulseCompanyId != null && Number(pulseCompanyId) > 0) {
      retentionWatch = await listCompanyRetentionWatches(queryRead, {
        companyId: pulseCompanyId,
        days: 14,
        limit: 5,
      });
      const retentionIds = new Set(
        (retentionWatch.items || []).map((r) => String(r.candidateId))
      );
      for (const row of retentionWatch.items || []) {
        attention.push({
          id: `retention-${row.candidateId}`,
          priority: 'medium',
          kind: 'retention_watch',
          titleKey: 'panel.overview.attnRetentionWatch',
          context: [row.name, row.signalLabels].filter(Boolean).join(' · '),
          days: daysAgo(row.createdAt) ?? 0,
          nav: {
            tab: 'team',
            candidate: String(row.candidateId),
            ...(row.name ? { search: row.name } : {}),
          },
        });
      }
      // C10 — check-in concern ∩ retention_watch
      try {
        const concernRes = await queryRead(
          `SELECT DISTINCT ON (o.candidate_id)
             o.candidate_id AS "candidateId",
             c.full_name AS name,
             o.completed_at AS "completedAt",
             o.milestone_days AS "milestoneDays"
           FROM employee_onboarding_checkins o
           JOIN candidates c ON c.id = o.candidate_id AND c.company_id = o.company_id
           WHERE o.company_id = $1
             AND o.status = 'done'
             AND o.outcome = 'concern'
             AND o.completed_at >= NOW() - INTERVAL '45 days'
           ORDER BY o.candidate_id, o.completed_at DESC NULLS LAST
           LIMIT 12`,
          [pulseCompanyId]
        );
        for (const row of concernRes.rows || []) {
          if (!retentionIds.has(String(row.candidateId))) continue;
          attention.push({
            id: `concern-ret-${row.candidateId}`,
            priority: 'high',
            kind: 'concern_retention',
            titleKey: 'panel.overview.attnConcernRetention',
            context: [row.name, row.milestoneDays != null ? `D${row.milestoneDays}` : null]
              .filter(Boolean)
              .join(' · '),
            days: daysAgo(row.completedAt) ?? 0,
            nav: {
              tab: 'team',
              candidate: String(row.candidateId),
              ...(row.name ? { search: row.name } : {}),
            },
          });
        }
      } catch (err) {
        if (err?.code !== '42P01' && err?.code !== '42703') {
          console.error('[overview-metrics] concern_retention', err?.message || err);
        }
      }
    }

    /** Batch funnel stats for the short vacancy list (avoids per-row LATERAL on all open jobs). */
    const vacIds = vacList.rows.map((r) => Number(r.id)).filter((id) => Number.isFinite(id) && id > 0);
    const vacStatsById = new Map();
    if (vacIds.length > 0) {
      try {
        const [assStats, vcMax] = await Promise.all([
          queryRead(
            `SELECT
               ass.vacancy_id AS "vacancyId",
               COUNT(*) FILTER (WHERE ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.HIRED}')::int AS hired,
               COUNT(*) FILTER (
                 WHERE ${canonicalStageExprSql('ass')} NOT IN ('${PIPELINE_STAGE.REJECTED}', '${PIPELINE_STAGE.ARCHIVED}')
               )::int AS "inFunnel",
               COUNT(*) FILTER (
                 WHERE ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.APPROVED}'
                   AND COALESCE(ass.offer_status, '${OFFER_STATUS.NONE}') = '${OFFER_STATUS.NONE}'
               )::int AS "approvedGaps",
               MAX(ass.created_at) AS "lastAss"
             FROM assessments ass
             ${canonicalStageJoinSql('ass')}
             WHERE ass.vacancy_id = ANY($1::bigint[])
             GROUP BY ass.vacancy_id`,
            [vacIds]
          ),
          queryRead(
            `SELECT vacancy_id AS "vacancyId", MAX(updated_at) AS "lastVc"
             FROM vacancy_candidates
             WHERE vacancy_id = ANY($1::bigint[])
             GROUP BY vacancy_id`,
            [vacIds]
          ),
        ]);
        for (const row of assStats.rows || []) {
          vacStatsById.set(Number(row.vacancyId), {
            hired: row.hired || 0,
            inFunnel: row.inFunnel || 0,
            approvedGaps: row.approvedGaps || 0,
            lastAss: row.lastAss,
            lastVc: null,
          });
        }
        for (const row of vcMax.rows || []) {
          const id = Number(row.vacancyId);
          const cur = vacStatsById.get(id) || {
            hired: 0,
            inFunnel: 0,
            approvedGaps: 0,
            lastAss: null,
            lastVc: null,
          };
          cur.lastVc = row.lastVc;
          vacStatsById.set(id, cur);
        }
      } catch (err) {
        console.error('[overview-metrics] vacStats', err?.message || err);
      }
    }

    let positionsOpen = 0;
    let staleCount = 0;
    const items = vacList.rows.map((row) => {
      const need = Math.max(1, Number(row.positionsCount) || 1);
      const st = vacStatsById.get(Number(row.id));
      const hired = st ? Number(st.hired) || 0 : Number(row.hired) || 0;
      const remaining = Math.max(0, need - hired);
      positionsOpen += remaining;
      const lastActivity =
        st && (st.lastAss || st.lastVc)
          ? [st.lastAss, st.lastVc].filter(Boolean).sort().pop()
          : row.lastActivity;
      const staleDays = daysAgo(lastActivity);
      const isStale = staleDays == null || staleDays >= 7;
      if (isStale) staleCount += 1;
      return {
        id: row.id,
        title: row.title,
        positionsCount: need,
        hired,
        remaining,
        inFunnel: st ? Number(st.inFunnel) || 0 : Number(row.inFunnel) || 0,
        approvedGaps: st ? Number(st.approvedGaps) || 0 : Number(row.approvedGaps) || 0,
        targetDate: row.targetDate ? String(row.targetDate).slice(0, 10) : null,
        lastActivityDays: staleDays,
        stale: isStale,
      };
    });

    let peopleOps = null;
    let typeMixWindowDelta = null;
    let typeMixRubricDelta = null;
    let behavioralIntel = null;
    try {
      behavioralIntel = await loadTeamBehavioralIntel(
        { queryRead },
        {
          isAdmin,
          companyId,
          scopeCompanyFilter,
          selectedArea,
          selectedVacancy,
          enneagram: 'all',
          dateFrom,
          dateTo,
          nameSearch,
          rosterScope,
          locale,
          teamGroupId,
        }
      );
    } catch (err) {
      console.error('[overview-metrics] behavioralIntel', err?.message || err);
      behavioralIntel = null;
    }
    if (pulseCompanyId != null && Number(pulseCompanyId) > 0) {
      const [
        pdiPulse,
        climatePulse,
        enpsPulse,
        onboardingPulse,
        mixWindows,
        openRubrics,
        lmsOverduePulse,
        dpPulse,
        absenteeismPulse,
        compensationMarketPulse,
      ] =
        await Promise.all([
        getCompanyPdiPulse(queryRead, { companyId: pulseCompanyId }),
        getCompanyClimatePulse(queryRead, { companyId: pulseCompanyId }),
        getCompanyEnpsPulse(queryRead, { companyId: pulseCompanyId }),
        getCompanyOnboardingPulse(queryRead, { companyId: pulseCompanyId }),
        queryRead(
          `SELECT
             ass.top_type AS "topType",
             COUNT(*) FILTER (
               WHERE ass.created_at >= NOW() - INTERVAL '90 days'
             )::int AS recent,
             COUNT(*) FILTER (
               WHERE ass.created_at < NOW() - INTERVAL '90 days'
                 AND ass.created_at >= NOW() - INTERVAL '180 days'
             )::int AS prior
           FROM assessments ass
           JOIN candidates c ON c.id = ass.candidate_id
           WHERE c.company_id = $1
             AND ass.top_type BETWEEN 1 AND 9
           GROUP BY ass.top_type`,
          [pulseCompanyId]
        ).catch(() => ({ rows: [] })),
        queryRead(
          `SELECT r.desired_type_weights AS weights
           FROM vacancy_rubrics r
           JOIN vacancies v ON v.id = r.vacancy_id
           JOIN companies co ON co.id = v.company_id
           WHERE v.company_id = $1
             AND v.deleted = FALSE
             AND co.deleted = FALSE
             AND v.status = '${VACANCY_STATUS.OPEN}'
             AND r.desired_type_weights IS NOT NULL
           ORDER BY v.target_date ASC NULLS LAST, v.created_at DESC
           LIMIT 12`,
          [pulseCompanyId]
        ).catch(() => ({ rows: [] })),
        getCompanyLmsOverduePulse(queryRead, { companyId: pulseCompanyId }).catch(() => ({
          overdueCount: 0,
          mandatoryOverdueCount: 0,
          items: [],
        })),
        getDpAttentionPulse(queryRead, { companyId: pulseCompanyId }).catch(() => ({
          pendingDocs: [],
          leaves: [],
        })),
        getAbsenteeismPulse(queryRead, { companyId: pulseCompanyId }).catch(() => ({
          items: [],
          lookbackDays: 90,
        })),
        getCompensationMarketPulse(queryRead, { companyId: pulseCompanyId }).catch(() => ({
          items: [],
        })),
      ]);
      const recentCount = {};
      const priorCount = {};
      for (const row of mixWindows.rows || []) {
        const tt = Number(row.topType);
        if (tt >= 1 && tt <= 9) {
          if (row.recent) recentCount[tt] = row.recent;
          if (row.prior) priorCount[tt] = row.prior;
        }
      }
      typeMixWindowDelta = buildTypeMixWindowDelta(recentCount, priorCount);
      const openWeights = (openRubrics.rows || [])
        .map((r) => r.weights)
        .filter((w) => w && typeof w === 'object' && Object.keys(w).length > 0);
      typeMixRubricDelta = buildMixVsRubricAdvice(typeCount, openWeights);
      if (typeMixRubricDelta?.kind === 'empty' || typeMixRubricDelta?.kind === 'aligned') {
        /* keep aligned for UI optional line; empty stays null-ish via kind */
      }
      const retentionCount = (retentionWatch.items || []).length;
      const onboardingSignal =
        onboardingPulse &&
        ((onboardingPulse.overdueCount || 0) > 0 ||
          (onboardingPulse.dueSoonCount || 0) > 0 ||
          (onboardingPulse.pendingCount || 0) > 0);
      const climateDelta =
        climatePulse &&
        (climatePulse.deltaVsPrevious != null || climatePulse.latestMean != null);
      if (pdiPulse || climatePulse || enpsPulse || retentionCount > 0 || onboardingSignal || climateDelta) {
        peopleOps = {
          pdi: pdiPulse,
          climate: climatePulse,
          enps: enpsPulse,
          onboarding: onboardingPulse,
          retention: {
            count: retentionCount,
            minScore: retentionWatch.minScore,
            lookbackDays: retentionWatch.lookbackDays || 14,
          },
        };
      }

      const overdueItems = Number(pdiPulse?.overdueItemCount) || 0;
      const overduePlans = Number(pdiPulse?.overduePlanCount) || 0;
      if (overdueItems > 0 || overduePlans > 0) {
        attention.push({
          id: 'pdi-overdue',
          overdue: true,
          priority: 'high',
          kind: 'pdi_overdue',
          titleKey: 'panel.overview.attnPdiOverdue',
          context: [overdueItems > 0 ? String(overdueItems) : null, overduePlans > 0 ? String(overduePlans) : null]
            .filter(Boolean)
            .join(' · '),
          days: oldestOverdueDays(pdiPulse?.queue?.overdue),
          nav: { tab: 'pdi' },
        });
      }
      if ((Number(pdiPulse?.noPlanEmployeeCount) || 0) > 0) {
        attention.push({
          id: 'pdi-no-plan',
          priority: 'low',
          kind: 'pdi_no_plan',
          titleKey: 'panel.overview.attnPdiNoPlan',
          context: String(pdiPulse.noPlanEmployeeCount),
          days: null,
          nav: { tab: 'team' },
        });
      }
      if ((Number(climatePulse?.openSurveys) || 0) > 0) {
        attention.push({
          id: 'climate-open',
          priority: 'medium',
          kind: 'climate_open',
          titleKey: 'panel.overview.attnClimateOpen',
          context: String(climatePulse.openSurveys),
          days: null,
          nav: { tab: 'climate' },
        });
      }
      if ((Number(onboardingPulse?.overdueCount) || 0) > 0) {
        attention.push({
          id: 'onboarding-overdue',
          overdue: true,
          priority: 'high',
          kind: 'onboarding_overdue',
          titleKey: 'panel.overview.attnOnboardingOverdue',
          context: String(onboardingPulse.overdueCount),
          days: oldestOverdueDays(onboardingPulse.overdue),
          nav: { tab: 'team' },
        });
      }
      if ((Number(lmsOverduePulse?.overdueCount) || 0) > 0) {
        attention.push({
          id: 'lms-overdue',
          overdue: true,
          priority: 'high',
          kind: 'lms_overdue',
          titleKey: 'panel.overview.attnLmsOverdue',
          context: String(lmsOverduePulse.overdueCount),
          days: oldestOverdueDays(lmsOverduePulse.items),
          nav: { tab: 'lms' },
        });
      }
      const dpLeaveRequested = (dpPulse?.leaves || []).filter(
        (l) => l.status === DP_LEAVE_STATUS.REQUESTED
      ).length;
      if (dpLeaveRequested > 0) {
        attention.push({
          id: 'dp-leave-requested',
          priority: 'high',
          kind: 'dp_leave_requested',
          titleKey: 'panel.overview.attnDpLeave',
          context: String(dpLeaveRequested),
          days: null,
          nav: { tab: 'dp' },
        });
      }
      const dpDocsPeople = (dpPulse?.pendingDocs || []).length;
      if (dpDocsPeople > 0) {
        const first = dpPulse.pendingDocs[0];
        attention.push({
          id: 'dp-docs-pending',
          priority: 'medium',
          kind: 'dp_docs_pending',
          titleKey: 'panel.overview.attnDpDocs',
          context:
            dpDocsPeople === 1 && first?.candidateName
              ? first.candidateName
              : String(dpDocsPeople),
          days: null,
          nav: first?.candidateId
            ? {
                tab: 'team',
                candidate: String(first.candidateId),
                section: 'dp',
              }
            : { tab: 'team' },
        });
      }
      const absenteeismPeople = (absenteeismPulse?.items || []).length;
      if (absenteeismPeople > 0) {
        const first = absenteeismPulse.items[0];
        attention.push({
          id: 'absenteeism-elevated',
          priority: 'medium',
          kind: 'absenteeism_elevated',
          titleKey: 'panel.overview.attnAbsenteeism',
          context:
            absenteeismPeople === 1 && first?.candidateName
              ? `${first.candidateName} · ${first.daySum}d/${absenteeismPulse.lookbackDays || 90}d`
              : `${absenteeismPeople} · ${absenteeismPulse.lookbackDays || 90}d`,
          days: null,
          nav: first?.candidateId
            ? {
                tab: 'team',
                candidate: String(first.candidateId),
                section: 'dp',
              }
            : { tab: 'dp' },
        });
      }
      const belowMarketPeople = (compensationMarketPulse?.items || []).length;
      if (belowMarketPeople > 0) {
        const first = compensationMarketPulse.items[0];
        attention.push({
          id: 'comp-below-market',
          priority: 'medium',
          kind: 'comp_below_market',
          titleKey: 'panel.overview.attnCompBelowMarket',
          context:
            belowMarketPeople === 1 && first?.candidateName
              ? first.candidateName
              : String(belowMarketPeople),
          days: null,
          nav: first?.candidateId
            ? {
                tab: 'team',
                candidate: String(first.candidateId),
                section: 'compensation',
              }
            : { tab: 'compensation' },
        });
      }
      try {
        const succGap = await queryRead(
          `SELECT r.id, r.title
           FROM critical_roles r
           WHERE r.company_id = $1
             AND r.active = TRUE
             AND NOT EXISTS (
               SELECT 1 FROM succession_plans s WHERE s.critical_role_id = r.id
             )
           ORDER BY r.updated_at DESC NULLS LAST, r.id DESC
           LIMIT 3`,
          [pulseCompanyId]
        );
        for (const row of succGap.rows || []) {
          attention.push({
            id: `succ-gap-${row.id}`,
            priority: 'medium',
            kind: 'succession_gap',
            titleKey: 'panel.overview.attnSuccessionGap',
            context: row.title || String(row.id),
            days: null,
            nav: { tab: 'succession' },
          });
        }
      } catch (err) {
        if (err?.code !== '42P01' && err?.code !== '42703') {
          console.error('[overview-metrics] succession_gap', err?.message || err);
        }
      }
    }

    const organizedAttention = organizeOverviewAttention(attention);


    return {
      funnel,
      funnelTotal,
      hiredLast7d: hired7.rows[0]?.n ?? 0,
      rejectedLast7d: rejected7.rows[0]?.n ?? 0,
      rejectionReasons: reasonsRes.rows.map((r) => ({ reason: r.reason, n: r.n })),
      rejectionPatterns: (rejectPatternsRes.rows || [])
        .map((r) => ({
          reason: r.reason,
          topType: Number(r.topType),
          n: Number(r.n) || 0,
        }))
        .filter((r) => r.topType >= 1 && r.topType <= 9 && r.n > 0),
      attention: organizedAttention.current,
      attentionOlder: organizedAttention.older,
      attentionOldAfterDays: organizedAttention.oldAfterDays,
      vacancies: {
        openCount: openCountRes.rows[0]?.n ?? 0,
        positionsOpen,
        staleCount,
        items,
      },
      typeMix: {
        ...base.typeMix,
        windowDelta: typeMixWindowDelta,
        rubricDelta: typeMixRubricDelta,
      },
      behavioralIntel,
      peopleOps,
      error: false,
    };
  } catch (err) {
    console.error('[overview-metrics]', err?.message || err);
    return { ...base, error: true };
  }
}
