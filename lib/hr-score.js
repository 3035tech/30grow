/**
 * HR Score — núcleo de inteligência comportamental (B-1001)
 * 
 * Consolida sinais existentes em score 0-100 por colaborador:
 * - Perfil T1-T9 (completude)
 * - Motivadores (retention score)
 * - Fit vs núcleo da empresa
 * - PDI (progresso)
 * - Check-ins (concern)
 * - Clima agregado
 * - Retention watch
 * 
 * Regras:
 * - Hedging: score é indicador, não diagnóstico
 * - Reutiliza funções existentes
 * - Sem hub paralelo, sem inventar analytics engine
 */

import { query, queryRead } from './db.js';
import { asDb } from './ae/as-db.js';
import { retentionWatchMinScore } from './people/retention-watch.js';
import { getCompanyRecentLikertMean } from './people/climate-surveys.js';
import { DB_FANOUT_CONCURRENCY, mapWithConcurrency } from './concurrency.js';
import { ERR } from './api-error-codes.js';
import {
  DEVELOPMENT_PLAN_ITEM_STATUS,
  DEVELOPMENT_PLAN_STATUS,
  EMPLOYMENT_STATUS,
  PERFORMANCE_GOAL_OUTCOME,
  TURNOVER_TREND,
} from './domain-status.js';
import { calculateAllPredictions, loadRecentOneOnOneNotes, predictionsFromSignals } from './hr-predictions.js';
import { measureAsync } from './monitoring.js';
import {
  detectTrendChanges,
  emitTurnoverRiskChangeNotification,
} from './turnover-radar.js';
import {
  getHrScoreWithCache,
  invalidateHrScoreCache,
} from './hr-score-cache.js';
/**
 * Pesos dos sinais (total = 1.0)
 */
const SIGNAL_WEIGHTS = {
  profile: 0.15,     // Tem perfil T1-T9 completo
  motivators: 0.20,  // Score de retenção dos Motivadores
  fit: 0.15,         // Fit vs núcleo do time
  pdi: 0.20,         // Progresso do PDI
  checkins: 0.15,    // Outcomes dos check-ins
  climate: 0.10,     // Clima agregado da empresa
  retention: 0.05,   // Retention watch (inverso: quanto mais baixo, pior)
};

/**
 * Calcula score do sinal "perfil" (0-100)
 * Baseado na existência de assessment T1-T9
 */
async function calculateProfileScore(db, candidateId) {
  const res = await db.query(
    `SELECT top_type, scores, created_at
     FROM assessments
     WHERE candidate_id = $1
       AND top_type IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [candidateId]
  );

  if (res.rowCount === 0) {
    return { score: 0, detail: 'no_assessment' };
  }

  let hasSecondary = false;
  try {
    const raw = res.rows[0].scores;
    const scores = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ranked = Object.entries(scores || {})
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    hasSecondary = ranked.length >= 2;
  } catch {
    hasSecondary = false;
  }

  const ageMonths = Math.floor(
    (Date.now() - new Date(res.rows[0].created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );

  let score = 80;
  if (hasSecondary) score += 10;
  if (ageMonths < 12) score += 10;

  return {
    score: Math.min(100, score),
    detail: { hasSecondary, ageMonths },
  };
}

/**
 * Calcula score do sinal "motivators" (0-100)
 * Média das dimensões no ae_attempts.dimension_scores (não existe retention_score).
 */
async function calculateMotivatorsScore(db, candidateId) {
  const res = await db.query(
    `SELECT dimension_scores AS "dimensionScores", completed_at
     FROM ae_attempts
     WHERE candidate_id = $1
       AND status = 'completed'
       AND dimension_scores IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT 1`,
    [candidateId]
  );

  if (res.rowCount === 0) {
    return { score: 50, detail: 'no_attempt' };
  }

  const dims = res.rows[0].dimensionScores;
  const vals = Object.values(dims && typeof dims === 'object' ? dims : {})
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!vals.length) {
    return { score: 50, detail: 'empty_scores' };
  }
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;

  return {
    score: Math.round(Math.max(0, Math.min(100, avg))),
    detail: { avg: Math.round(avg) },
  };
}

/**
 * Calcula score do sinal "fit" (0-100)
 * Baseado no fit vs núcleo T1–T9 da empresa.
 * @param {object} db
 * @param {number} candidateId
 * @param {number} companyId
 * @param {{ nucleus?: Record<string, number>, totalEmployees?: number }|null} [preloaded]
 */
async function calculateFitScore(db, candidateId, companyId, preloaded = null) {
  let nucleus = preloaded?.nucleus || null;
  let totalEmployees = preloaded?.totalEmployees;

  if (!nucleus) {
    const nucleusRes = await db.query(
      `SELECT a.top_type AS "topType", COUNT(*)::int AS count
       FROM assessments a
       JOIN candidates c ON c.id = a.candidate_id AND c.company_id = $1
       WHERE a.top_type IS NOT NULL
         AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       GROUP BY a.top_type`,
      [companyId]
    );
    if (nucleusRes.rowCount === 0) {
      return { score: 50, detail: 'no_nucleus' };
    }
    nucleus = {};
    totalEmployees = 0;
    for (const row of nucleusRes.rows) {
      const n = parseInt(row.count, 10) || 0;
      nucleus[row.topType] = n;
      totalEmployees += n;
    }
  }

  if (!nucleus || !totalEmployees) {
    return { score: 50, detail: 'no_nucleus' };
  }

  const candidateRes = await db.query(
    `SELECT top_type FROM assessments WHERE candidate_id = $1 AND top_type IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [candidateId]
  );

  if (candidateRes.rowCount === 0) {
    return { score: 0, detail: 'no_type' };
  }

  const candidateType = candidateRes.rows[0].top_type;
  return fitScoreFromNucleus(candidateType, nucleus, totalEmployees);
}

function fitScoreFromNucleus(candidateType, nucleus, totalEmployees) {
  if (!nucleus || !totalEmployees) {
    return { score: 50, detail: 'no_nucleus' };
  }
  if (!candidateType) {
    return { score: 0, detail: 'no_type' };
  }
  const candidateCount = nucleus[candidateType] || nucleus[String(candidateType)] || 0;
  const prevalence = totalEmployees > 0 ? candidateCount / totalEmployees : 0;

  let score = 50;
  if (prevalence >= 0.3) score = 95;
  else if (prevalence >= 0.2) score = 85;
  else if (prevalence >= 0.1) score = 75;
  else if (prevalence > 0) score = 60;

  return {
    score,
    detail: { candidateType, prevalence: Math.round(prevalence * 100) },
  };
}

/**
 * Calcula score do sinal "pdi" (0-100)
 * Baseado no progresso dos planos ativos
 */
async function calculatePdiScore(db, candidateId) {
  const res = await db.query(
    `SELECT 
       COUNT(*) FILTER (WHERE status IN ('${DEVELOPMENT_PLAN_STATUS.ACTIVE}', '${DEVELOPMENT_PLAN_STATUS.DRAFT}')) as active_plans,
       COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id)), 0) as total_items,
       COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id AND i.status = '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}')), 0) as done_items
     FROM development_plans p
     WHERE p.candidate_id = $1`,
    [candidateId]
  );

  const activePlans = parseInt(res.rows[0].active_plans) || 0;
  const totalItems = parseInt(res.rows[0].total_items) || 0;
  const doneItems = parseInt(res.rows[0].done_items) || 0;

  if (activePlans === 0) {
    return { score: 70, detail: 'no_active_plans' }; // Sem plano não é penalização
  }

  if (totalItems === 0) {
    return { score: 60, detail: 'no_items' };
  }

  // Progresso: % de itens concluídos
  const progress = doneItems / totalItems;
  const score = 40 + Math.round(progress * 60); // 40-100

  return {
    score,
    detail: { activePlans, totalItems, doneItems, progress: Math.round(progress * 100) },
  };
}

/**
 * Calcula score do sinal "checkins" (0-100)
 * Baseado nos outcomes recentes
 */
async function calculateCheckinsScore(db, candidateId) {
  const res = await db.query(
    `SELECT outcome, completed_at
     FROM employee_onboarding_checkins
     WHERE candidate_id = $1
       AND completed_at IS NOT NULL
     ORDER BY milestone_days DESC
     LIMIT 3`,
    [candidateId]
  );

  if (res.rowCount === 0) {
    return { score: 70, detail: 'no_checkins' }; // Neutro se não tem
  }

  const concerns = res.rows.filter(r => r.outcome === 'concern').length;
  const develops = res.rows.filter(r => r.outcome === PERFORMANCE_GOAL_OUTCOME.DEVELOP).length;
  const onTracks = res.rows.filter(r => r.outcome === 'on_track').length;

  // Scoring: on_track=100, develop=70, concern=40
  const totalScore = (onTracks * 100 + develops * 70 + concerns * 40);
  const score = Math.round(totalScore / res.rowCount);

  return {
    score,
    detail: { concerns, develops, onTracks, total: res.rowCount },
  };
}

/**
 * Calcula score do sinal "climate" (0-100)
 * Baseado no clima agregado da empresa (respostas anônimas)
 */
async function calculateClimateScore(db, companyId) {
  const avgScore = await getCompanyRecentLikertMean(db, { companyId });

  if (avgScore == null) {
    return { score: 70, detail: 'no_recent_climate' }; // Neutro
  }

  // Clima é escala 1-5, normalizar para 0-100
  const score = Math.round(((avgScore - 1) / 4) * 100); // 1→0, 5→100

  return {
    score: Math.max(0, Math.min(100, score)),
    detail: { avgScore: avgScore.toFixed(2) },
  };
}

/**
 * Calcula score do sinal "retention" (0-100)
 * Baseado na ausência de retention_watch recente
 */
async function calculateRetentionScore(db, candidateId) {
  const minScore = retentionWatchMinScore();
  
  const res = await db.query(
    `SELECT n.created_at, n.payload
     FROM manager_notifications n
     WHERE n.type = 'retention_watch'
       AND n.entity_id = $1
       AND n.created_at > NOW() - INTERVAL '30 days'
     ORDER BY n.created_at DESC
     LIMIT 1`,
    [candidateId]
  );

  if (res.rowCount === 0) {
    return { score: 100, detail: 'no_recent_watch' }; // Sem alerta = bom
  }

  // Tem alerta recente = score reduzido
  const daysAgo = Math.floor(
    (Date.now() - new Date(res.rows[0].created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Quanto mais recente, pior o score
  let score = 100 - (30 - daysAgo) * 2; // 30 dias atrás = 40, hoje = 100
  score = Math.max(30, Math.min(100, score));

  return {
    score,
    detail: { daysAgo, minScore },
  };
}

/**
 * Calcula HR Score consolidado 0-100 para um candidato.
 * @param {number} candidateId
 * @param {number} companyId
 * @param {{ nucleus?: object, totalEmployees?: number, climate?: { score: number, detail: any } }|null} [companyCtx]
 */
export async function calculateHrScore(candidateId, companyId, companyCtx = null) {
  const db = asDb(query);

  const climatePromise = companyCtx?.climate
    ? Promise.resolve(companyCtx.climate)
    : calculateClimateScore(db, companyId);

  const [profile, motivators, fit, pdi, checkins, climate, retention] = await Promise.all([
    calculateProfileScore(db, candidateId),
    calculateMotivatorsScore(db, candidateId),
    calculateFitScore(db, candidateId, companyId, companyCtx),
    calculatePdiScore(db, candidateId),
    calculateCheckinsScore(db, candidateId),
    climatePromise,
    calculateRetentionScore(db, candidateId),
  ]);

  return assembleHrScore({ profile, motivators, fit, pdi, checkins, climate, retention });
}

function assembleHrScore({ profile, motivators, fit, pdi, checkins, climate, retention }) {
  const weightedScore =
    profile.score * SIGNAL_WEIGHTS.profile +
    motivators.score * SIGNAL_WEIGHTS.motivators +
    fit.score * SIGNAL_WEIGHTS.fit +
    pdi.score * SIGNAL_WEIGHTS.pdi +
    checkins.score * SIGNAL_WEIGHTS.checkins +
    climate.score * SIGNAL_WEIGHTS.climate +
    retention.score * SIGNAL_WEIGHTS.retention;

  const finalScore = Math.round(weightedScore);

  const signals = {
    profile: { score: profile.score, weight: SIGNAL_WEIGHTS.profile, detail: profile.detail },
    motivators: { score: motivators.score, weight: SIGNAL_WEIGHTS.motivators, detail: motivators.detail },
    fit: { score: fit.score, weight: SIGNAL_WEIGHTS.fit, detail: fit.detail },
    pdi: { score: pdi.score, weight: SIGNAL_WEIGHTS.pdi, detail: pdi.detail },
    checkins: { score: checkins.score, weight: SIGNAL_WEIGHTS.checkins, detail: checkins.detail },
    climate: { score: climate.score, weight: SIGNAL_WEIGHTS.climate, detail: climate.detail },
    retention: { score: retention.score, weight: SIGNAL_WEIGHTS.retention, detail: retention.detail },
  };

  return {
    score: Math.max(0, Math.min(100, finalScore)),
    signals,
  };
}

/**
 * Salva (upsert) HR Score no banco
 */
export async function saveHrScore(candidateId, companyId, scoreData, predictions = {}) {
  await saveHrScores(query, companyId, [{ candidateId, scoreData, predictions }]);
}

/**
 * Upsert many HR Scores of one company in a single statement.
 * @param {{ candidateId: number, scoreData: { score: number, signals: object }, predictions?: object }[]} rows
 */
export async function saveHrScores(dbOrQuery, companyId, rows) {
  if (!rows?.length) return;
  const db = asDb(dbOrQuery);
  await db.query(
    `INSERT INTO hr_scores (
       candidate_id, company_id, score, signals,
       turnover_risk, turnover_reasons, pdi_gap_areas,
       calculated_at
     )
     SELECT u.candidate_id, $1, u.score, u.signals::jsonb, u.turnover_risk, u.turnover_reasons::jsonb, u.pdi_gap_areas::jsonb, NOW()
     FROM unnest($2::bigint[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[])
          AS u(candidate_id, score, signals, turnover_risk, turnover_reasons, pdi_gap_areas)
     ON CONFLICT (candidate_id)
     DO UPDATE SET
       score = EXCLUDED.score,
       signals = EXCLUDED.signals,
       turnover_risk = EXCLUDED.turnover_risk,
       turnover_reasons = EXCLUDED.turnover_reasons,
       pdi_gap_areas = EXCLUDED.pdi_gap_areas,
       calculated_at = NOW()`,
    [
      companyId,
      rows.map((r) => r.candidateId),
      rows.map((r) => r.scoreData.score),
      rows.map((r) => JSON.stringify(r.scoreData.signals)),
      rows.map((r) => r.predictions?.turnover_risk || null),
      rows.map((r) => JSON.stringify(r.predictions?.turnover_reasons || [])),
      rows.map((r) => JSON.stringify(r.predictions?.pdi_gap_areas || [])),
    ]
  );
  for (const r of rows) invalidateHrScoreCache(r.candidateId);
}

/**
 * Busca HR Scores salvos em lote (candidate_id → score ou null).
 */
export async function getHrScoresByCandidateIds(dbOrQuery, candidateIds) {
  const db = asDb(dbOrQuery);
  const ids = [...new Set(
    (Array.isArray(candidateIds) ? candidateIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];
  const out = new Map();
  if (!ids.length) return out;

  const res = await db.query(
    `SELECT candidate_id AS "candidateId", score
     FROM hr_scores
     WHERE candidate_id = ANY($1::bigint[])`,
    [ids]
  );
  for (const row of res.rows) {
    out.set(Number(row.candidateId), row.score != null ? Number(row.score) : null);
  }
  return out;
}

/**
 * Busca HR Score salvo (ou retorna null). Cache TTL em memória (ver hr-score-cache).
 */
export async function getHrScore(candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return getHrScoreWithCache(id, async () => {
    const res = await queryRead(
      `SELECT 
         id, candidate_id AS "candidateId", company_id AS "companyId",
         score, signals,
         turnover_risk AS "turnoverRisk",
         turnover_reasons AS "turnoverReasons",
         pdi_gap_areas AS "pdiGapAreas",
         calculated_at AS "calculatedAt"
       FROM hr_scores
       WHERE candidate_id = $1
       LIMIT 1`,
      [id]
    );

    if (res.rowCount === 0) return null;

    return {
      ...res.rows[0],
      signals: res.rows[0].signals || {},
      turnoverReasons: res.rows[0].turnoverReasons || [],
      pdiGapAreas: res.rows[0].pdiGapAreas || [],
    };
  });
}

/**
 * Recalcula scores de toda a empresa (batch).
 * Núcleo T1–T9 + clima uma vez; sinais por colaborador via IN (sem N×7 queries).
 */
export async function recalculateCompanyScores(companyId, opts = {}) {
  return measureAsync('hrScore.recalculateCompany', () => recalculateCompanyScoresUnmetered(companyId, opts));
}

async function recalculateCompanyScoresUnmetered(companyId, { limit = 100 } = {}) {
  const db = asDb(query);
  const cid = Number(companyId);
  const cap = Math.min(200, Math.max(1, Number(limit) || 100));

  const res = await db.query(
    `SELECT id, full_name AS "fullName" FROM candidates
     WHERE company_id = $1
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     ORDER BY id ASC
     LIMIT $2`,
    [cid, cap]
  );

  if (res.rowCount === 0) {
    return { processed: 0, results: [], turnoverNotified: 0 };
  }

  const candidates = res.rows;
  const ids = candidates.map((r) => Number(r.id));

  const [nucleusRes, climate, profileRes, motivatorsRes, pdiRes, checkinsRes, retentionRes, typesRes] =
    await Promise.all([
      db.query(
        `SELECT a.top_type AS "topType", COUNT(*)::int AS count
         FROM assessments a
         JOIN candidates c ON c.id = a.candidate_id AND c.company_id = $1
         WHERE a.top_type IS NOT NULL
           AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
         GROUP BY a.top_type`,
        [cid]
      ),
      calculateClimateScore(db, cid),
      db.query(
        `SELECT DISTINCT ON (candidate_id)
           candidate_id AS "candidateId", top_type AS "topType", scores, created_at AS "createdAt"
         FROM assessments
         WHERE candidate_id = ANY($1::bigint[])
           AND top_type IS NOT NULL
         ORDER BY candidate_id, created_at DESC`,
        [ids]
      ),
      db.query(
        `SELECT DISTINCT ON (candidate_id)
           candidate_id AS "candidateId",
           dimension_scores AS "dimensionScores"
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
           COUNT(*) FILTER (WHERE p.status IN ('${DEVELOPMENT_PLAN_STATUS.ACTIVE}', '${DEVELOPMENT_PLAN_STATUS.DRAFT}'))::int AS active_plans,
           COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id)), 0)::int AS total_items,
           COALESCE(SUM((SELECT COUNT(*)::int FROM development_plan_items i WHERE i.plan_id = p.id AND i.status = '${DEVELOPMENT_PLAN_ITEM_STATUS.DONE}')), 0)::int AS done_items
         FROM development_plans p
         WHERE p.candidate_id = ANY($1::bigint[])
         GROUP BY p.candidate_id`,
        [ids]
      ),
      db.query(
        `SELECT candidate_id AS "candidateId", outcome, completed_at, milestone_days
         FROM (
           SELECT candidate_id, outcome, completed_at, milestone_days,
                  ROW_NUMBER() OVER (
                    PARTITION BY candidate_id
                    ORDER BY milestone_days DESC
                  ) AS rn
           FROM employee_onboarding_checkins
           WHERE candidate_id = ANY($1::bigint[])
             AND completed_at IS NOT NULL
         ) ranked
         WHERE rn <= 3`,
        [ids]
      ),
      db.query(
        `SELECT DISTINCT ON (entity_id)
           entity_id AS "candidateId", created_at AS "createdAt", payload
         FROM manager_notifications
         WHERE type = 'retention_watch'
           AND entity_id = ANY($1::bigint[])
           AND created_at > NOW() - INTERVAL '30 days'
         ORDER BY entity_id, created_at DESC`,
        [ids]
      ),
      db.query(
        `SELECT DISTINCT ON (candidate_id)
           candidate_id AS "candidateId", top_type AS "topType"
         FROM assessments
         WHERE candidate_id = ANY($1::bigint[])
           AND top_type IS NOT NULL
         ORDER BY candidate_id, created_at DESC`,
        [ids]
      ),
    ]);
  const [changes, notesById] = await Promise.all([
    detectTrendChanges(db, cid, ids),
    loadRecentOneOnOneNotes(db, ids),
  ]);

  const nucleus = {};
  let totalEmployees = 0;
  for (const row of nucleusRes.rows) {
    const n = parseInt(row.count, 10) || 0;
    nucleus[row.topType] = n;
    totalEmployees += n;
  }

  const profileById = new Map();
  for (const row of profileRes.rows) {
    profileById.set(Number(row.candidateId), row);
  }
  const motivatorsById = new Map();
  for (const row of motivatorsRes.rows) {
    motivatorsById.set(Number(row.candidateId), row.dimensionScores);
  }
  const pdiById = new Map();
  for (const row of pdiRes.rows) {
    pdiById.set(Number(row.candidateId), row);
  }
  const checkinsById = new Map();
  for (const row of checkinsRes.rows) {
    const id = Number(row.candidateId);
    if (!checkinsById.has(id)) checkinsById.set(id, []);
    checkinsById.get(id).push(row);
  }
  const retentionById = new Map();
  for (const row of retentionRes.rows) {
    retentionById.set(Number(row.candidateId), row);
  }
  const typeById = new Map();
  for (const row of typesRes.rows) {
    typeById.set(Number(row.candidateId), row.topType);
  }

  const computed = candidates.map((row, index) => {
    const id = Number(row.id);
    try {
      const profile = profileSignalFromRow(profileById.get(id));
      const motivators = motivatorsSignalFromDims(motivatorsById.get(id));
      const fit = fitScoreFromNucleus(typeById.get(id), nucleus, totalEmployees);
      const pdi = pdiSignalFromRow(pdiById.get(id));
      const checkins = checkinsSignalFromRows(checkinsById.get(id) || []);
      const retention = retentionSignalFromRow(retentionById.get(id));

      const scoreData = assembleHrScore({
        profile,
        motivators,
        fit,
        pdi,
        checkins,
        climate,
        retention,
      });
      const predictions = predictionsFromSignals(scoreData.signals, notesById.get(id));
      return { row, index, id, scoreData, predictions };
    } catch (err) {
      console.error(`[hr-score] Error calculating for candidate ${id}:`, err);
      return { row, index, id, error: err.message };
    }
  });

  const toSave = computed.filter((c) => !c.error);
  try {
    await saveHrScores(db, cid, toSave.map((c) => ({ candidateId: c.id, scoreData: c.scoreData, predictions: c.predictions })));
  } catch (err) {
    console.error(`[hr-score] Error saving scores for company ${cid}:`, err);
    for (const c of toSave) c.error = err.message;
  }

  const results = computed.map((c) => (c.error
    ? { candidateId: c.id, ok: false, error: c.error }
    : { candidateId: c.id, score: c.scoreData.score, turnoverRisk: c.predictions.turnover_risk || null, ok: true }));

  const worsened = computed.filter((c) => !c.error && changes.get(c.id)?.trend === TURNOVER_TREND.WORSENING);
  let turnoverNotified = 0;
  await mapWithConcurrency(worsened, DB_FANOUT_CONCURRENCY, async (c) => {
    try {
      const emit = await emitTurnoverRiskChangeNotification(query, {
        candidateId: c.id,
        companyId: cid,
        candidateName: c.row.fullName,
        change: changes.get(c.id),
      });
      if (emit.notified) turnoverNotified += 1;
    } catch (err) {
      console.error(`[hr-score] Error notifying risk change for candidate ${c.id}:`, err);
      results[c.index] = { candidateId: c.id, ok: false, error: err.message };
    }
  });

  return { processed: results.length, results, turnoverNotified };
}

/**
 * Recalculate and save one employee's HR Score, then notify managers if the turnover
 * risk worsened (only after the save). `companyId` must be the candidate's company.
 */
export async function recalculateCandidateHrScore({ candidateId, companyId, candidateName = null }) {
  const id = Number(candidateId);
  const changes = await detectTrendChanges(query, companyId, [id]);
  const scoreData = await calculateHrScore(id, companyId);
  const predictions = await calculateAllPredictions(id, scoreData.signals);
  await saveHrScore(id, companyId, scoreData, predictions);
  await emitTurnoverRiskChangeNotification(query, {
    candidateId: id,
    companyId,
    candidateName,
    change: changes.get(id),
  });
  return { scoreData, predictions };
}

function profileSignalFromRow(row) {
  if (!row) return { score: 0, detail: 'no_assessment' };
  let hasSecondary = false;
  try {
    const raw = row.scores;
    const scores = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ranked = Object.entries(scores || {})
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => b[1] - a[1]);
    hasSecondary = ranked.length >= 2;
  } catch {
    hasSecondary = false;
  }
  const ageMonths = Math.floor(
    (Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );
  let score = 80;
  if (hasSecondary) score += 10;
  if (ageMonths < 12) score += 10;
  return { score: Math.min(100, score), detail: { hasSecondary, ageMonths } };
}

function motivatorsSignalFromDims(dims) {
  if (!dims || typeof dims !== 'object') {
    return { score: 50, detail: 'no_attempt' };
  }
  const vals = Object.values(dims)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!vals.length) return { score: 50, detail: 'empty_scores' };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { score: Math.round(Math.max(0, Math.min(100, avg))), detail: { avg: Math.round(avg) } };
}

function pdiSignalFromRow(row) {
  if (!row) return { score: 70, detail: 'no_active_plans' };
  const activePlans = parseInt(row.active_plans, 10) || 0;
  const totalItems = parseInt(row.total_items, 10) || 0;
  const doneItems = parseInt(row.done_items, 10) || 0;
  if (activePlans === 0) return { score: 70, detail: 'no_active_plans' };
  if (totalItems === 0) return { score: 60, detail: 'no_items' };
  const progress = doneItems / totalItems;
  return {
    score: 40 + Math.round(progress * 60),
    detail: { activePlans, totalItems, doneItems, progress: Math.round(progress * 100) },
  };
}

function checkinsSignalFromRows(rows) {
  if (!rows.length) return { score: 70, detail: 'no_checkins' };
  const concerns = rows.filter((r) => r.outcome === 'concern').length;
  const develops = rows.filter((r) => r.outcome === PERFORMANCE_GOAL_OUTCOME.DEVELOP).length;
  const onTracks = rows.filter((r) => r.outcome === 'on_track').length;
  const totalScore = onTracks * 100 + develops * 70 + concerns * 40;
  return {
    score: Math.round(totalScore / rows.length),
    detail: { concerns, develops, onTracks, total: rows.length },
  };
}

function retentionSignalFromRow(row) {
  const minScore = retentionWatchMinScore();
  if (!row) return { score: 100, detail: 'no_recent_watch' };
  const daysAgo = Math.floor(
    (Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  let score = 100 - (30 - daysAgo) * 2;
  score = Math.max(30, Math.min(100, score));
  return { score, detail: { daysAgo, minScore } };
}

/**
 * Rollup de scores por área
 * Note: candidates has no `area` column yet — returns [] until modeled.
 */
export async function getCompanyScoresByArea(companyId) {
  void companyId;
  return [];
}

/**
 * Full company HR Score dashboard payload (company + overall + top/bottom).
 */
export async function getCompanyHrScoreRollup(companyId) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }

  const companyRes = await queryRead(
    `SELECT id, name FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [cid]
  );
  if (companyRes.rowCount === 0) {
    return { ok: false, errorCode: ERR.COMPANY_NOT_FOUND };
  }

  const overallRes = await queryRead(
    `SELECT
       COUNT(h.id)::int AS total,
       ROUND(AVG(h.score))::int AS avg_score,
       MIN(h.score)::int AS min_score,
       MAX(h.score)::int AS max_score
     FROM hr_scores h
     JOIN candidates c ON c.id = h.candidate_id
     WHERE h.company_id = $1
       AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    [cid]
  );

  const performerSelect = `
    SELECT
      c.id, c.full_name AS "fullName",
      h.score, h.turnover_risk AS "turnoverRisk"
    FROM hr_scores h
    JOIN candidates c ON c.id = h.candidate_id
    WHERE h.company_id = $1
      AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`;

  const [topRes, bottomRes, byArea] = await Promise.all([
    queryRead(`${performerSelect} ORDER BY h.score DESC NULLS LAST LIMIT 5`, [cid]),
    queryRead(`${performerSelect} ORDER BY h.score ASC NULLS LAST LIMIT 5`, [cid]),
    getCompanyScoresByArea(cid),
  ]);

  const row = overallRes.rows[0] || {};
  return {
    ok: true,
    company: { id: companyRes.rows[0].id, name: companyRes.rows[0].name },
    overall: {
      total: Number(row.total) || 0,
      avgScore: Number(row.avg_score) || 0,
      minScore: Number(row.min_score) || 0,
      maxScore: Number(row.max_score) || 0,
    },
    byArea,
    topPerformers: topRes.rows,
    bottomPerformers: bottomRes.rows,
  };
}


