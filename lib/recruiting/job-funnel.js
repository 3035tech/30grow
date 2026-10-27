/**
 * Eventos de funil da vaga pública (job_view → apply → pipeline).
 */

import { query, queryRead } from '../db.js';
import { checkRateLimit } from '../identity/rate-limit.js';
import { ERR } from '../api-error-codes.js';
import { PIPELINE_STAGE } from './pipeline.js';

export const FUNNEL_EVENT_TYPES = new Set([
  'job_view',
  'apply_start',
  'apply_complete',
  'screening',
  'interview',
  'hired',
  'rejected',
]);

/** Pipeline stage → evento de funil (só estágios relevantes). */
export function pipelineStageToFunnelEvent(stage) {
  const s = String(stage || '').trim();
  if (s === PIPELINE_STAGE.SCREENING || s === PIPELINE_STAGE.APPROVED) return 'screening';
  if (s === PIPELINE_STAGE.INTERVIEW) return 'interview';
  if (s === PIPELINE_STAGE.HIRED) return 'hired';
  if (s === PIPELINE_STAGE.REJECTED) return 'rejected';
  return null;
}

/**
 * @param {{
 *   companyId: number,
 *   vacancyId: number,
 *   eventType: string,
 *   candidateId?: number|null,
 *   sessionId?: string|null,
 *   source?: string|null,
 *   medium?: string|null,
 *   campaign?: string|null,
 *   referralCode?: string|null,
 * }} input
 */
export async function recordJobFunnelEvent(input) {
  const companyId = Number(input.companyId);
  const vacancyId = Number(input.vacancyId);
  const eventType = String(input.eventType || '').trim();
  if (!Number.isFinite(companyId) || companyId <= 0) return { ok: false, reason: 'company' };
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) return { ok: false, reason: 'vacancy' };
  if (!FUNNEL_EVENT_TYPES.has(eventType)) return { ok: false, reason: 'type' };

  const sessionId = input.sessionId ? String(input.sessionId).slice(0, 64) : null;

  // Dedupa view por sessão (evita flood de refresh)
  if (eventType === 'job_view' && sessionId) {
    const rl = await checkRateLimit(`job_view:${vacancyId}:${sessionId}`, 1, 30 * 60 * 1000);
    if (!rl.ok) return { ok: true, skipped: true, reason: 'dedupe' };
  }
  if (eventType === 'apply_start' && sessionId) {
    const rl = await checkRateLimit(`apply_start:${vacancyId}:${sessionId}`, 3, 60 * 60 * 1000);
    if (!rl.ok) return { ok: true, skipped: true, reason: 'dedupe' };
  }

  const candidateId =
    input.candidateId != null && Number.isFinite(Number(input.candidateId))
      ? Number(input.candidateId)
      : null;

  await query(
    `INSERT INTO job_funnel_events (
       company_id, vacancy_id, candidate_id, event_type, session_id,
       source, medium, campaign, referral_code
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      companyId,
      vacancyId,
      candidateId,
      eventType,
      sessionId,
      input.source ? String(input.source).slice(0, 80) : null,
      input.medium ? String(input.medium).slice(0, 80) : null,
      input.campaign ? String(input.campaign).slice(0, 120) : null,
      input.referralCode ? String(input.referralCode).slice(0, 64) : null,
    ]
  );
  return { ok: true };
}

/**
 * Fire-and-forget seguro (nunca propaga erro ao caller).
 */
export function scheduleJobFunnelEvent(input) {
  try {
    void recordJobFunnelEvent(input).catch((err) => {
      console.error(
        JSON.stringify({
          event: 'job_funnel_failed',
          detail: err?.message || String(err),
          vacancyId: input?.vacancyId ?? null,
          type: input?.eventType ?? null,
        })
      );
    });
  } catch {
    /* ignore */
  }
}

/**
 * Analytics agregado por vaga (tenant).
 * @param {{ vacancyId: number, companyId?: number|null, isAdmin?: boolean }} opts
 */
export async function getVacancyFunnelAnalytics(opts) {
  const vacancyId = Number(opts.vacancyId);
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_VACANCY };
  }

  const params = [vacancyId];
  let companyFilter = '';
  if (!opts.isAdmin) {
    const companyId = Number(opts.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return { ok: false, errorCode: ERR.UNAUTHORIZED };
    }
    params.push(companyId);
    companyFilter = `AND company_id = $2`;
  }

  const owned = await queryRead(
    `SELECT v.id, v.company_id AS "companyId", v.title
     FROM vacancies v
     WHERE v.id = $1 AND v.deleted = FALSE
       ${opts.isAdmin ? '' : 'AND v.company_id = $2'}
     LIMIT 1`,
    opts.isAdmin ? [vacancyId] : [vacancyId, opts.companyId]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const counts = await queryRead(
    `SELECT
       event_type AS "eventType",
       COUNT(*)::int AS total,
       COUNT(DISTINCT session_id)::int AS "uniqueSessions"
     FROM job_funnel_events
     WHERE vacancy_id = $1 ${companyFilter}
     GROUP BY event_type`,
    params
  );

  const byType = Object.fromEntries(
    (counts.rows || []).map((r) => [
      r.eventType,
      { total: r.total, uniqueSessions: r.uniqueSessions },
    ])
  );

  const views = byType.job_view?.uniqueSessions || byType.job_view?.total || 0;
  const applyStarts = byType.apply_start?.total || 0;
  const applications = byType.apply_complete?.total || 0;
  const interviews = byType.interview?.total || 0;
  const hires = byType.hired?.total || 0;
  const conversionRate = views > 0 ? Math.round((applications / views) * 1000) / 1000 : null;

  const sources = await queryRead(
    `SELECT
       COALESCE(NULLIF(TRIM(source), ''), '(none)') AS source,
       COUNT(*) FILTER (WHERE event_type = 'job_view')::int AS views,
       COUNT(*) FILTER (WHERE event_type = 'apply_complete')::int AS applications,
       COUNT(*) FILTER (WHERE event_type = 'hired')::int AS hires
     FROM job_funnel_events
     WHERE vacancy_id = $1 ${companyFilter}
     GROUP BY 1
     ORDER BY applications DESC, views DESC
     LIMIT 30`,
    params
  );

  const stagePerformanceResult = await queryRead(
    `WITH movements AS (
       SELECT 'assessment:' || ass.id::text AS entity_key,
              h.to_stage AS stage_key,
              h.changed_at
       FROM assessment_pipeline_history h
       JOIN assessments ass ON ass.id = h.assessment_id
       WHERE ass.vacancy_id = $1 AND ass.company_id = $2
       UNION ALL
       SELECT 'candidate:' || vc.id::text AS entity_key,
              h.to_stage AS stage_key,
              h.changed_at
       FROM vacancy_candidate_pipeline_history h
       JOIN vacancy_candidates vc ON vc.id = h.vacancy_candidate_id
       WHERE vc.vacancy_id = $1 AND vc.company_id = $2
     ), ordered AS (
       SELECT entity_key, stage_key, changed_at,
              LEAD(changed_at) OVER (PARTITION BY entity_key ORDER BY changed_at, stage_key) AS next_at
       FROM movements
     ), aggregated AS (
       SELECT stage_key,
              COUNT(DISTINCT entity_key)::int AS entered,
              ROUND(AVG(EXTRACT(EPOCH FROM (next_at - changed_at)) / 86400.0)::numeric, 1) AS avg_days
       FROM ordered GROUP BY stage_key
     )
     SELECT stages.stage_key AS "stageKey", stages.label_pt AS "labelPt",
            stages.label_en AS "labelEn", stages.sort_order AS "sortOrder",
            COALESCE(aggregated.entered, 0)::int AS entered,
            aggregated.avg_days::float AS "avgDays"
     FROM vacancy_pipeline_stages stages
     LEFT JOIN aggregated ON aggregated.stage_key = stages.stage_key
     WHERE stages.vacancy_id = $1 AND stages.company_id = $2
     ORDER BY stages.sort_order, stages.id`,
    [vacancyId, owned.rows[0].companyId]
  );
  const stagePerformance = (stagePerformanceResult.rows || []).map((stage, index, all) => ({
    ...stage,
    entered: Number(stage.entered || 0),
    avgDays: stage.avgDays == null ? null : Number(stage.avgDays),
    conversionToNext: index < all.length - 1 && Number(stage.entered) > 0
      ? Math.min(1, Math.round((Number(all[index + 1].entered || 0) / Number(stage.entered)) * 1000) / 1000)
      : null,
  }));
  const bottlenecks = stagePerformance.flatMap((stage) => {
    const signals = [];
    if (stage.entered >= 3 && stage.avgDays != null && stage.avgDays >= 7) signals.push('slow_stage');
    if (stage.entered >= 5 && stage.conversionToNext != null && stage.conversionToNext < 0.35) signals.push('low_conversion');
    return signals.map((signal) => ({
      signal,
      stageKey: stage.stageKey,
      labelPt: stage.labelPt,
      labelEn: stage.labelEn,
      entered: stage.entered,
      avgDays: stage.avgDays,
      conversionToNext: stage.conversionToNext,
    }));
  }).slice(0, 6);

  return {
    ok: true,
    vacancyId,
    companyId: owned.rows[0].companyId,
    title: owned.rows[0].title,
    views,
    applyStarts,
    applications,
    interviews,
    hires,
    conversionRate,
    byType,
    sources: (sources.rows || []).map((r) => ({
      source: r.source,
      views: r.views,
      applications: r.applications,
      hires: r.hires,
    })),
    stagePerformance,
    bottlenecks,
  };
}
