/**
 * Turnover Radar — monitoramento multi-sinal de risco de rotatividade (B-1002)
 *
 * Complementa HR Score (B-1001) com foco específico em turnover:
 * - Clima (queda ou score baixo)
 * - Retention Motivadores (score abaixo de threshold)
 * - PDI concern/atraso
 * - Check-ins concern
 *
 * Diferença do HR Score:
 * - Apenas sinais críticos de turnover (não engajamento geral)
 * - Detecção de tendência (piora recente)
 * - Gatilho para notificações proativas
 */

import { query, queryRead } from './db.js';
import { asDb } from './ae/as-db.js';
import { retentionWatchMinScore } from './people/retention-watch.js';
import { getCompanyRecentLikertMean } from './people/climate-surveys.js';
import {
  DEVELOPMENT_PLAN_ITEM_STATUS,
  DEVELOPMENT_PLAN_STATUS,
  EMPLOYMENT_STATUS,
  PERFORMANCE_GOAL_OUTCOME,
  TURNOVER_TREND,
} from './domain-status.js';
import { notifyCompanyManagers, NOTIF } from './manager-notifications.js';
import { measureAsync } from './monitoring.js';

const RISK_LEVELS = Object.freeze({ low: 0, medium: 1, high: 2 });
const KNOWN_RISKS = new Set(Object.keys(RISK_LEVELS));

/**
 * Pesos dos sinais no radar (total = 1.0)
 * Mais focado em turnover do que o HR Score geral
 */
const RADAR_WEIGHTS = {
  climate: 0.30, // Clima baixo ou em queda
  motivators: 0.30, // Retention score Motivadores
  pdi: 0.25, // PDI atrasado ou concern
  checkins: 0.15, // Check-ins com concern
};

/**
 * Thresholds de risco
 */
const RISK_THRESHOLDS = {
  high: 60, // >= 60 = high risk
  medium: 40, // 40-59 = medium risk
  low: 0, // < 40 = low risk
};

const EMPLOYEE_SCAN_CAP = 500;

function climateFromAvg(avgScore, source) {
  const normalized = Math.round(((avgScore - 1) / 4) * 100); // 1-5 → 0-100
  return {
    score: 100 - normalized, // Inverter: quanto menor o clima, maior o risco
    source,
    detail: { avgScore: avgScore.toFixed(2) },
  };
}

function climateNone() {
  return { score: 30, source: 'none', detail: {} };
}

/** Retention-sensitive Motivators dims (same set as management-hypotheses). */
const RETENTION_DIM_KEYS = ['financeiro', 'equilibrio', 'reconhecimento', 'seguranca'];

function motivatorsFromDimensionScores(dimensionScores) {
  if (!dimensionScores || typeof dimensionScores !== 'object') {
    return { score: 30, source: 'none', detail: {} };
  }
  const minScore = retentionWatchMinScore();
  let retentionScore = 0;
  for (const key of RETENTION_DIM_KEYS) {
    const v = Number(dimensionScores[key]);
    if (Number.isFinite(v)) retentionScore = Math.max(retentionScore, v);
  }
  if (retentionScore <= 0) {
    return { score: 30, source: 'none', detail: {} };
  }
  // High retention-dim score = watch signal → elevate turnover risk
  return {
    score: Math.round(Math.max(0, Math.min(100, retentionScore))),
    source: 'motivators',
    detail: {
      retentionScore,
      minScore,
      belowThreshold: retentionScore < minScore,
      watch: retentionScore >= minScore,
    },
  };
}

function pdiFromCounts(activePlans, todoItems, doneItems) {
  if (activePlans === 0) {
    return { score: 20, source: 'none', detail: {} };
  }
  const totalItems = todoItems + doneItems;
  if (totalItems === 0) {
    return { score: 40, source: 'empty', detail: {} };
  }
  const progress = doneItems / totalItems;
  const riskScore = Math.round((1 - progress) * 100);
  return {
    score: riskScore,
    source: 'pdi',
    detail: { activePlans, todoItems, doneItems, progress: Math.round(progress * 100) },
  };
}

function checkinsFromRows(rows) {
  if (!rows || rows.length === 0) {
    return { score: 20, source: 'none', detail: {} };
  }
  const concerns = rows.filter((r) => r.outcome === 'concern').length;
  const develops = rows.filter((r) => r.outcome === PERFORMANCE_GOAL_OUTCOME.DEVELOP).length;
  const onTracks = rows.filter((r) => r.outcome === 'on_track' || r.outcome === 'continue').length;
  const riskScore = Math.round((concerns * 100 + develops * 50 + onTracks * 0) / rows.length);
  return {
    score: riskScore,
    source: 'checkins',
    detail: { concerns, develops, onTracks, total: rows.length },
  };
}

function assembleRadar(climate, motivators, pdi, checkins) {
  const riskScore = Math.round(
    climate.score * RADAR_WEIGHTS.climate +
      motivators.score * RADAR_WEIGHTS.motivators +
      pdi.score * RADAR_WEIGHTS.pdi +
      checkins.score * RADAR_WEIGHTS.checkins
  );

  let risk = 'low';
  if (riskScore >= RISK_THRESHOLDS.high) risk = 'high';
  else if (riskScore >= RISK_THRESHOLDS.medium) risk = 'medium';

  const actions = [];
  if (climate.score > 60) actions.push('review_climate');
  if (motivators.score > 60) actions.push('motivators_interview');
  if (pdi.score > 60) actions.push('accelerate_pdi');
  if (checkins.score > 60) actions.push('schedule_one_on_one');

  return {
    riskScore: Math.min(100, riskScore),
    risk,
    signals: {
      climate: { ...climate, weight: RADAR_WEIGHTS.climate },
      motivators: { ...motivators, weight: RADAR_WEIGHTS.motivators },
      pdi: { ...pdi, weight: RADAR_WEIGHTS.pdi },
      checkins: { ...checkins, weight: RADAR_WEIGHTS.checkins },
    },
    actions,
  };
}

function positiveIds(candidateIds) {
  return [...new Set(
    (Array.isArray(candidateIds) ? candidateIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  )];
}

/**
 * Radar of every candidate in 4 queries whatever the count: company climate mean once
 * (responses are anonymous, no per-employee signal), latest Motivators attempt, PDI counts
 * and last 3 check-ins via ANY(ids). Callers pass ids already scoped to `companyId`.
 *
 * @returns {Promise<Map<number, {riskScore: number, risk: string, signals: object, actions: string[]}>>}
 */
export async function loadTurnoverRadars(dbOrQuery, companyId, candidateIds) {
  const db = asDb(dbOrQuery);
  const ids = positiveIds(candidateIds);
  const out = new Map();
  if (!ids.length) return out;

  const [companyAvg, motivatorsRes, pdiRes, checkinsRes] = await Promise.all([
    getCompanyRecentLikertMean(db, { companyId }),
    db.query(
      `SELECT DISTINCT ON (candidate_id)
         candidate_id AS "candidateId", dimension_scores AS "dimensionScores"
       FROM ae_attempts
       WHERE candidate_id = ANY($1::bigint[])
         AND status = 'completed'
         AND dimension_scores IS NOT NULL
       ORDER BY candidate_id, completed_at DESC`,
      [ids]
    ),
    db.query(
      `SELECT
         p.candidate_id AS "candidateId",
         COUNT(*) FILTER (WHERE p.status = '${DEVELOPMENT_PLAN_STATUS.ACTIVE}')::int AS active_plans,
         COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id AND i.status = '${DEVELOPMENT_PLAN_ITEM_STATUS.TODO}')), 0)::int AS todo_items,
         COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id AND i.status = '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}')), 0)::int AS done_items
       FROM development_plans p
       WHERE p.candidate_id = ANY($1::bigint[])
       GROUP BY p.candidate_id`,
      [ids]
    ),
    db.query(
      `SELECT candidate_id AS "candidateId", outcome
       FROM (
         SELECT candidate_id, outcome,
                ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY milestone_days DESC) AS rn
         FROM employee_onboarding_checkins
         WHERE candidate_id = ANY($1::bigint[])
           AND completed_at IS NOT NULL
       ) ranked
       WHERE rn <= 3`,
      [ids]
    ),
  ]);

  const motivatorsById = new Map(motivatorsRes.rows.map((r) => [Number(r.candidateId), r.dimensionScores]));
  const pdiById = new Map(pdiRes.rows.map((r) => [Number(r.candidateId), r]));
  const checkinsById = new Map();
  for (const row of checkinsRes.rows) {
    const cid = Number(row.candidateId);
    if (!checkinsById.has(cid)) checkinsById.set(cid, []);
    checkinsById.get(cid).push(row);
  }

  const climate = companyAvg != null ? climateFromAvg(companyAvg, 'company') : climateNone();
  for (const id of ids) {
    const pdi = pdiById.get(id);
    out.set(id, assembleRadar(
      climate,
      motivatorsFromDimensionScores(motivatorsById.get(id) || null),
      pdiFromCounts(pdi?.active_plans || 0, pdi?.todo_items || 0, pdi?.done_items || 0),
      checkinsFromRows(checkinsById.get(id) || [])
    ));
  }
  return out;
}

/**
 * Calcula o radar de turnover para um colaborador
 *
 * @param {number} candidateId
 * @param {number} companyId
 * @returns {Promise<{riskScore: number, risk: string, signals: object, actions: string[]}>}
 */
export async function calculateTurnoverRadar(candidateId, companyId) {
  const radars = await loadTurnoverRadars(queryRead, companyId, [candidateId]);
  return radars.get(Number(candidateId))
    || assembleRadar(climateNone(), motivatorsFromDimensionScores(null), pdiFromCounts(0, 0, 0), checkinsFromRows([]));
}

function matchesMinRisk(risk, minRisk) {
  if (minRisk === 'high') return risk === 'high';
  if (minRisk === 'medium') return risk === 'high' || risk === 'medium';
  return true; // 'low' or anything else → include all
}

/**
 * Lista colaboradores em risco de rotatividade (medium + high)
 *
 * Batch: few queries with IN / GROUP BY (not per-employee calculateTurnoverRadar).
 *
 * @param {number} companyId
 * @param {object} options
 * @returns {Promise<{ risks: Array, truncated: boolean, scanned: number, scanCap: number }>}
 */
export async function getCompanyTurnoverRisks(companyId, opts = {}) {
  return measureAsync('turnover.getCompanyRisks', () => getCompanyTurnoverRisksUnmetered(companyId, opts));
}

async function getCompanyTurnoverRisksUnmetered(companyId, { limit = 20, minRisk = 'medium' } = {}) {
  const db = asDb(queryRead);
  const resultLimit = Math.min(Math.max(1, Number(limit) || 20), EMPLOYEE_SCAN_CAP);

  // candidates has no `deleted` column; employment_status is the employee flag
  const candidatesRes = await db.query(
    `SELECT id, full_name AS "fullName", NULL::text AS area, email
     FROM candidates
     WHERE company_id = $1
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY id
     LIMIT $2`,
    [companyId, EMPLOYEE_SCAN_CAP]
  );

  if (candidatesRes.rowCount === 0) {
    return {
      risks: [],
      truncated: false,
      scanned: 0,
      scanCap: EMPLOYEE_SCAN_CAP,
      distribution: { low: 0, medium: 0, high: 0 },
    };
  }

  const candidates = candidatesRes.rows;
  const ids = candidates.map((c) => c.id);
  const truncated = candidatesRes.rowCount >= EMPLOYEE_SCAN_CAP;
  const distribution = { low: 0, medium: 0, high: 0 };

  const radars = await loadTurnoverRadars(db, companyId, ids);
  const results = [];

  for (const candidate of candidates) {
    const cid = Number(candidate.id);
    const radar = radars.get(cid);

    if (distribution[radar.risk] != null) {
      distribution[radar.risk] += 1;
    }

    if (!matchesMinRisk(radar.risk, minRisk)) continue;

    results.push({
      candidateId: cid,
      candidateName: candidate.fullName,
      area: candidate.area,
      email: candidate.email,
      riskScore: radar.riskScore,
      risk: radar.risk,
      signals: radar.signals,
      actions: radar.actions,
    });
  }

  results.sort((a, b) => b.riskScore - a.riskScore);
  return {
    risks: results.slice(0, resultLimit),
    truncated,
    scanned: candidates.length,
    scanCap: EMPLOYEE_SCAN_CAP,
    distribution,
  };
}

/**
 * Detecta mudança de tendência (para notificações)
 * Compara radar atual com histórico de HR Score.
 * Só marca worsening em low→medium, medium→high, low→high (níveis conhecidos).
 */
export async function detectTrendChange(candidateId) {
  const db = asDb(queryRead);

  const previousRes = await db.query(
    `SELECT turnover_risk AS "turnoverRisk", calculated_at AS "calculatedAt"
     FROM hr_scores
     WHERE candidate_id = $1
     LIMIT 1`,
    [candidateId]
  );

  if (previousRes.rowCount === 0) {
    return { trend: TURNOVER_TREND.NEW, previous: null, current: null, radar: null };
  }

  const previous = previousRes.rows[0].turnoverRisk;

  const candidateRes = await db.query(
    `SELECT company_id AS "companyId" FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );

  if (candidateRes.rowCount === 0) {
    return { trend: TURNOVER_TREND.UNKNOWN, previous, current: null, radar: null };
  }

  const radar = await calculateTurnoverRadar(candidateId, candidateRes.rows[0].companyId);
  return turnoverTrend(previous, radar);
}

/** Saved risk (hr_scores) vs current radar risk. */
export function turnoverTrend(previous, radar) {
  const current = radar.risk;
  if (!KNOWN_RISKS.has(previous) || !KNOWN_RISKS.has(current)) {
    return { trend: previous == null ? TURNOVER_TREND.NEW : TURNOVER_TREND.UNKNOWN, previous, current, radar };
  }
  const delta = RISK_LEVELS[current] - RISK_LEVELS[previous];
  const trend = delta > 0 ? TURNOVER_TREND.WORSENING : delta < 0 ? TURNOVER_TREND.IMPROVING : TURNOVER_TREND.STABLE;
  return { trend, previous, current, radar };
}

/**
 * detectTrendChange for many employees of one company in 5 queries (saved risks + one
 * loadTurnoverRadars), instead of ~6 per person. Read before saving the new scores.
 *
 * @returns {Promise<Map<number, object>>} id → same shape as detectTrendChange
 */
export async function detectTrendChanges(dbOrQuery, companyId, candidateIds) {
  const db = asDb(dbOrQuery);
  const ids = positiveIds(candidateIds);
  const out = new Map();
  if (!ids.length) return out;

  const previousRes = await db.query(
    `SELECT candidate_id AS "candidateId", turnover_risk AS "turnoverRisk"
     FROM hr_scores
     WHERE candidate_id = ANY($1::bigint[])`,
    [ids]
  );
  const previousById = new Map(previousRes.rows.map((r) => [Number(r.candidateId), r.turnoverRisk]));
  const radars = await loadTurnoverRadars(db, companyId, ids.filter((id) => previousById.has(id)));
  for (const id of ids) {
    out.set(id, previousById.has(id)
      ? turnoverTrend(previousById.get(id), radars.get(id))
      : { trend: TURNOVER_TREND.NEW, previous: null, current: null, radar: null });
  }
  return out;
}

/**
 * Emite NOTIF.TURNOVER_RISK_CHANGE quando detectTrendChange já marcou worsening.
 * Dedupe diário por transição (candidate + from + to + dia UTC).
 */
export async function emitTurnoverRiskChangeNotification(
  dbOrQuery,
  { candidateId, companyId, candidateName = null, change } = {}
) {
  if (!change || change.trend !== TURNOVER_TREND.WORSENING) {
    return { notified: false };
  }
  const cid = Number(candidateId);
  const company = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(company) || company <= 0) {
    return { notified: false };
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  await notifyCompanyManagers(dbOrQuery || query, {
    companyId: company,
    type: NOTIF.TURNOVER_RISK_CHANGE,
    entityType: 'candidate',
    entityId: cid,
    dedupeKey: `turnover_risk_change:${cid}:${change.previous}:${change.current}:${dayKey}`,
    payload: {
      candidateId: cid,
      candidateName: candidateName || null,
      from: change.previous,
      to: change.current,
    },
  });

  return { notified: true };
}

/**
 * Detecta + notifica se o risco piorou.
 * Preferir recalculateCandidateHrScore (hr-score.js): tendência → save → emit
 * para não notificar se o upsert falhar.
 *
 * @returns {Promise<{ notified: boolean, change: object }>}
 */
export async function notifyTurnoverRiskChangeIfWorsened(
  dbOrQuery,
  { candidateId, companyId, candidateName = null } = {}
) {
  const cid = Number(candidateId);
  const company = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(company) || company <= 0) {
    return { notified: false, change: null };
  }

  const change = (await detectTrendChanges(queryRead, company, [cid])).get(cid);
  const emit = await emitTurnoverRiskChangeNotification(dbOrQuery, {
    candidateId: cid,
    companyId: company,
    candidateName,
    change,
  });
  return { notified: emit.notified, change };
}

/**
 * Batch: detecta piora de risco para colaboradores da empresa e notifica.
 * Preferir o hook em recalculateCompanyScores; esta função serve reprocessamento pontual.
 */
export async function notifyTurnoverRiskChanges(companyId, { limit = 100 } = {}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { processed: 0, notified: 0 };
  }

  const cap = Math.min(200, Math.max(1, Number(limit) || 100));
  const db = asDb(queryRead);
  const res = await db.query(
    `SELECT id, full_name AS "fullName"
     FROM candidates
     WHERE company_id = $1
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY id ASC
     LIMIT $2`,
    [cid, cap]
  );

  const changes = await detectTrendChanges(db, cid, res.rows.map((r) => r.id));
  let notified = 0;
  for (const row of res.rows) {
    const change = changes.get(Number(row.id));
    if (change?.trend !== TURNOVER_TREND.WORSENING) continue;
    const emit = await emitTurnoverRiskChangeNotification(query, {
      candidateId: row.id,
      companyId: cid,
      candidateName: row.fullName,
      change,
    });
    if (emit.notified) notified += 1;
  }

  return { processed: res.rowCount, notified };
}
