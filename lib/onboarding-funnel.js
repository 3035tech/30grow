/**
 * MVP-08 — funil do assistente de primeiro acesso (onde o gestor novo abandona)
 * e primeiro valor por empresa (primeira vaga / primeira pessoa analisada).
 */
import { ERR } from './api-error-codes.js';
import {
  ONBOARDING_EVENT,
  ONBOARDING_EVENTS,
  ONBOARDING_OBJECTIVES,
  ONBOARDING_STEP,
  ONBOARDING_STEPS,
} from './domain-status.js';

export const ONBOARDING_FUNNEL_DAY_OPTIONS = Object.freeze([30, 90]);
export const ONBOARDING_FUNNEL_COMPANY_CAP = 50;

export function normalizeFunnelDays(raw) {
  const n = Number(raw);
  return ONBOARDING_FUNNEL_DAY_OPTIONS.includes(n) ? n : ONBOARDING_FUNNEL_DAY_OPTIONS[0];
}

/**
 * Idempotent per (user, step, event): retries and re-renders never inflate the funnel.
 */
export async function recordOnboardingEvent(db, { companyId, userId, step, event, objective = null }) {
  const cid = Number(companyId);
  const uid = Number(userId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(uid) || uid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (!ONBOARDING_STEPS.includes(step) || !ONBOARDING_EVENTS.includes(event)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const obj = objective && ONBOARDING_OBJECTIVES.includes(objective) ? objective : null;
  await db.query(
    `INSERT INTO onboarding_events (company_id, user_id, step, event, objective)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, step, event) DO NOTHING`,
    [cid, uid, step, event, obj]
  );
  return { ok: true };
}

function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cohort = managers who opened the wizard (welcome viewed) in the last `days`.
 * Abandoned = cohort users with onboarding_completed = FALSE, bucketed by the furthest step viewed.
 */
export async function getOnboardingFunnel(db, { days: rawDays } = {}) {
  const days = normalizeFunnelDays(rawDays);
  const stepOrder = ONBOARDING_STEPS;

  const [stepsRes, abandonRes, objectiveRes, companiesRes] = await Promise.all([
    db.query(
      `WITH cohort AS (
         SELECT DISTINCT user_id FROM onboarding_events
         WHERE step = $2 AND event = $3 AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       )
       SELECT e.step, e.event, COUNT(DISTINCT e.user_id)::int AS users
       FROM onboarding_events e
       JOIN cohort c ON c.user_id = e.user_id
       GROUP BY e.step, e.event`,
      [days, ONBOARDING_STEP.WELCOME, ONBOARDING_EVENT.VIEWED]
    ),
    db.query(
      `WITH cohort AS (
         SELECT DISTINCT user_id FROM onboarding_events
         WHERE step = $2 AND event = $3 AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       ),
       furthest AS (
         SELECT e.user_id, MAX(array_position($4::text[], e.step)) AS pos
         FROM onboarding_events e
         JOIN cohort c ON c.user_id = e.user_id
         WHERE e.event = $3
         GROUP BY e.user_id
       )
       SELECT ($4::text[])[f.pos] AS step,
              COUNT(*) FILTER (WHERE u.onboarding_completed IS NOT TRUE)::int AS abandoned,
              COUNT(*) FILTER (WHERE u.onboarding_completed IS TRUE)::int AS finished
       FROM furthest f
       JOIN users u ON u.id = f.user_id
       GROUP BY f.pos`,
      [days, ONBOARDING_STEP.WELCOME, ONBOARDING_EVENT.VIEWED, stepOrder]
    ),
    db.query(
      `SELECT objective, COUNT(DISTINCT user_id)::int AS users
       FROM onboarding_events
       WHERE objective IS NOT NULL AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY objective`,
      [days]
    ),
    db.query(
      `SELECT e.company_id, co.name AS company_name, MIN(e.created_at) AS started_at,
              MAX(array_position($2::text[], e.step)) FILTER (WHERE e.event = $3) AS furthest_pos,
              BOOL_OR(e.step = $4 AND e.event = $5) AS reached_done,
              BOOL_OR(e.event = $6) AS skipped
       FROM onboarding_events e
       JOIN companies co ON co.id = e.company_id
       WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY e.company_id, co.name
       ORDER BY MIN(e.created_at) DESC
       LIMIT $7`,
      [
        days,
        stepOrder,
        ONBOARDING_EVENT.VIEWED,
        ONBOARDING_STEP.DONE,
        ONBOARDING_EVENT.COMPLETED,
        ONBOARDING_EVENT.SKIPPED,
        ONBOARDING_FUNNEL_COMPANY_CAP,
      ]
    ),
  ]);

  const counts = new Map();
  for (const r of stepsRes.rows) counts.set(`${r.step}:${r.event}`, Number(r.users) || 0);
  const abandonByStep = new Map();
  let finishedUsers = 0;
  for (const r of abandonRes.rows) {
    if (r.step) abandonByStep.set(r.step, Number(r.abandoned) || 0);
    finishedUsers += Number(r.finished) || 0;
  }
  const startedUsers = counts.get(`${ONBOARDING_STEP.WELCOME}:${ONBOARDING_EVENT.VIEWED}`) || 0;

  const steps = stepOrder.map((step) => {
    const viewed = counts.get(`${step}:${ONBOARDING_EVENT.VIEWED}`) || 0;
    return {
      step,
      viewed,
      completed: counts.get(`${step}:${ONBOARDING_EVENT.COMPLETED}`) || 0,
      skipped: counts.get(`${step}:${ONBOARDING_EVENT.SKIPPED}`) || 0,
      abandoned: abandonByStep.get(step) || 0,
      reachPct: startedUsers ? Math.round((viewed / startedUsers) * 100) : 0,
    };
  });

  const companyIds = companiesRes.rows.map((r) => Number(r.company_id));
  const firstValue = new Map();
  if (companyIds.length) {
    const fvRes = await db.query(
      `SELECT c.id AS company_id,
              (SELECT MIN(v.created_at) FROM vacancies v
                WHERE v.company_id = c.id AND v.deleted = FALSE) AS first_vacancy_at,
              (SELECT MIN(a.created_at) FROM assessments a
                WHERE a.company_id = c.id AND a.top_type IS NOT NULL) AS first_analysis_at
       FROM companies c
       WHERE c.id = ANY($1::bigint[])`,
      [companyIds]
    );
    for (const r of fvRes.rows) firstValue.set(Number(r.company_id), r);
  }

  // Value that predates the wizard (seeded or migrated data) is not time-to-value.
  const hoursBetween = (from, to) => {
    if (!from || !to) return null;
    const diff = (new Date(to).getTime() - new Date(from).getTime()) / 3600000;
    return diff >= 0 ? diff : null;
  };

  const companies = companiesRes.rows.map((r) => {
    const id = Number(r.company_id);
    const fv = firstValue.get(id) || {};
    const firstValueAt = [fv.first_vacancy_at, fv.first_analysis_at]
      .filter(Boolean)
      .map((d) => new Date(d))
      .sort((a, b) => a - b)[0] || null;
    return {
      companyId: id,
      companyName: r.company_name,
      startedAt: r.started_at,
      furthestStep: r.furthest_pos ? stepOrder[Number(r.furthest_pos) - 1] : null,
      reachedDone: Boolean(r.reached_done),
      skipped: Boolean(r.skipped),
      firstVacancyAt: fv.first_vacancy_at || null,
      firstAnalysisAt: fv.first_analysis_at || null,
      hoursToFirstValue: firstValueAt ? hoursBetween(r.started_at, firstValueAt) : null,
    };
  });

  const withValue = companies.filter((c) => c.firstVacancyAt || c.firstAnalysisAt);
  const objectives = {};
  for (const r of objectiveRes.rows) objectives[r.objective] = Number(r.users) || 0;

  return {
    days,
    startedUsers,
    finishedUsers,
    steps,
    objectives,
    companies,
    companyCap: ONBOARDING_FUNNEL_COMPANY_CAP,
    firstValue: {
      companies: companies.length,
      withVacancy: companies.filter((c) => c.firstVacancyAt).length,
      withAnalysis: companies.filter((c) => c.firstAnalysisAt).length,
      withAny: withValue.length,
      medianHours: median(withValue.map((c) => c.hoursToFirstValue)),
    },
  };
}
