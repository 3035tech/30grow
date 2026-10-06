/**
 * HR Predictions — predições baseadas em sinais consolidados (B-1001)
 * 
 * - Risco de rotatividade (turnover risk)
 * - Gaps de PDI
 * - Aderência ao perfil ideal
 * 
 * Reutiliza sinais calculados em hr-score.js
 */

import { queryRead } from './db.js';
import { asDb } from './ae/as-db.js';
import { retentionWatchMinScore } from './people/retention-watch.js';
import { VACANCY_STATUS } from './domain-status.js';

/**
 * Prediz risco de rotatividade baseado em múltiplos sinais
 * 
 * @param {number} candidateId 
 * @param {object} signals - Breakdown de sinais do HR Score
 * @returns {Promise<{risk: string, reasons: string[], score: number}>}
 */
export async function predictTurnoverRisk(candidateId, signals = {}) {
  return turnoverRiskFromSignals(signals);
}

export function turnoverRiskFromSignals(signals = {}) {
  const reasons = [];
  let riskScore = 0; // 0-100, quanto maior, maior o risco

  // Sinal 1: Retention watch ativo (peso alto)
  if (signals.retention && signals.retention.score < 70) {
    riskScore += 30;
    reasons.push('retention_watch_active');
  }

  // Sinal 2: Motivadores com score de retenção baixo
  if (signals.motivators && signals.motivators.score < 60) {
    riskScore += 25;
    reasons.push('motivators_retention_low');
  }

  // Sinal 3: Clima da empresa baixo
  if (signals.climate && signals.climate.score < 60) {
    riskScore += 15;
    reasons.push('climate_low');
  }

  // Sinal 4: PDI atrasado ou sem progresso
  if (signals.pdi && signals.pdi.score < 50) {
    riskScore += 15;
    reasons.push('pdi_delayed');
  }

  // Sinal 5: Check-ins com concerns recentes
  if (signals.checkins && signals.checkins.detail?.concerns > 0) {
    riskScore += 15;
    reasons.push('concern_checkins');
  }

  // Sinal 6: Fit baixo vs núcleo
  if (signals.fit && signals.fit.score < 60) {
    riskScore += 10;
    reasons.push('low_fit_nucleus');
  }

  // Classificar risco
  let risk = 'low';
  if (riskScore >= 50) risk = 'high';
  else if (riskScore >= 30) risk = 'medium';

  return {
    risk,
    reasons,
    score: Math.min(100, riskScore),
  };
}

/**
 * Prediz áreas de desenvolvimento prioritárias (gaps de PDI)
 * 
 * @param {number} candidateId 
 * @param {object} signals 
 * @returns {Promise<Array<{area: string, priority: string, reason: string}>>}
 */
export async function predictPdiGaps(candidateId, signals = {}) {
  const notes = await loadRecentOneOnOneNotes(queryRead, [candidateId]);
  return pdiGapsFromSignals(signals, notes.get(Number(candidateId)) || []);
}

/** Last 5 1:1 notes per candidate (newest first), one query for any number of ids. */
export async function loadRecentOneOnOneNotes(dbOrQuery, candidateIds) {
  const db = asDb(dbOrQuery);
  const ids = [...new Set((candidateIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const res = await db.query(
    `SELECT candidate_id AS "candidateId", notes
     FROM (
       SELECT candidate_id, notes,
              ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY meeting_date DESC) AS rn
       FROM one_on_ones
       WHERE candidate_id = ANY($1::bigint[])
         AND notes IS NOT NULL
     ) ranked
     WHERE rn <= 5
     ORDER BY candidate_id, rn`,
    [ids]
  );
  for (const row of res.rows) {
    const id = Number(row.candidateId);
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(row.notes);
  }
  return out;
}

/** @param {string[]} recentNotes newest 1:1 notes (see loadRecentOneOnOneNotes) */
export function pdiGapsFromSignals(signals = {}, recentNotes = []) {
  const gaps = [];

  // Gap 1: Leadership (se tem concerns ou baixo fit)
  if (
    (signals.checkins && signals.checkins.detail?.concerns > 0) ||
    (signals.fit && signals.fit.score < 70)
  ) {
    gaps.push({
      area: 'leadership',
      priority: 'high',
      reason: 'concern_or_low_fit',
    });
  }

  // Gap 2: Engagement (se clima baixo ou retention watch)
  if (
    (signals.climate && signals.climate.score < 60) ||
    (signals.retention && signals.retention.score < 70)
  ) {
    gaps.push({
      area: 'engagement',
      priority: 'high',
      reason: 'climate_or_retention',
    });
  }

  // Gap 3: Development (se PDI está atrasado)
  if (signals.pdi && signals.pdi.score < 60) {
    gaps.push({
      area: 'development',
      priority: 'medium',
      reason: 'pdi_delayed',
    });
  }

  // Gap 4: Profile alignment (se perfil está desatualizado)
  if (
    signals.profile &&
    signals.profile.detail?.ageMonths &&
    signals.profile.detail.ageMonths > 18
  ) {
    gaps.push({
      area: 'profile_update',
      priority: 'low',
      reason: 'outdated_assessment',
    });
  }

  // Temas recorrentes de 1:1 — análise simples de texto (palavras-chave)
  const allNotes = recentNotes.map(n => String(n || '').toLowerCase()).join(' ');
  
  if (allNotes.includes('comunicação') || allNotes.includes('communication')) {
    gaps.push({
      area: 'communication',
      priority: 'medium',
      reason: 'mentioned_in_one_on_ones',
    });
  }

  if (allNotes.includes('técnica') || allNotes.includes('technical') || allNotes.includes('skill')) {
    gaps.push({
      area: 'technical_skills',
      priority: 'medium',
      reason: 'mentioned_in_one_on_ones',
    });
  }

  // Remover duplicatas e ordenar por prioridade
  const uniqueGaps = Array.from(
    new Map(gaps.map(g => [g.area, g])).values()
  );

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  uniqueGaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return uniqueGaps.slice(0, 5); // Max 5 gaps
}

/**
 * Calcula aderência ao perfil ideal (fit score detalhado)
 * Reutiliza área-fit existente mas com mais contexto
 * 
 * @param {number} candidateId 
 * @param {object} signals 
 * @returns {Promise<{score: number, breakdown: object}>}
 */
export async function calculateProfileFitScore(candidateId, signals = {}) {
  const db = asDb(queryRead);

  // Buscar vagas ativas do candidato (rubrica em vacancy_rubrics, não em vacancies)
  const vacancyRes = await db.query(
    `SELECT v.id, v.title, r.desired_type_weights AS rubric
     FROM vacancies v
     JOIN vacancy_candidates vc ON vc.vacancy_id = v.id
     LEFT JOIN vacancy_rubrics r ON r.vacancy_id = v.id
     WHERE vc.candidate_id = $1
       AND v.status = '${VACANCY_STATUS.OPEN}'
       AND v.deleted = FALSE
     LIMIT 1`,
    [candidateId]
  );

  if (vacancyRes.rowCount === 0) {
    // Sem vaga, usar fit vs núcleo geral
    return {
      score: signals.fit?.score || 50,
      breakdown: {
        source: 'company_nucleus',
        detail: signals.fit?.detail || {},
      },
    };
  }

  const vacancy = vacancyRes.rows[0];
  
  // Se tem rubrica, calcular fit específico da vaga
  // (Reutilizar lógica de area-fit.js aqui se necessário)
  
  return {
    score: signals.fit?.score || 50,
    breakdown: {
      source: 'vacancy_rubric',
      vacancyId: vacancy.id,
      vacancyTitle: vacancy.title,
      detail: signals.fit?.detail || {},
    },
  };
}

/**
 * Calcula todas as predições para um candidato
 * (wrapper conveniente)
 */
export async function calculateAllPredictions(candidateId, signals) {
  const [pdiGaps, fit] = await Promise.all([
    predictPdiGaps(candidateId, signals),
    calculateProfileFitScore(candidateId, signals),
  ]);
  return { ...predictionsFromSignals(signals, null, pdiGaps), profile_fit: fit };
}

/**
 * The persisted predictions (hr_scores columns), no queries. Pass `recentNotes` from
 * loadRecentOneOnOneNotes, or precomputed `pdiGaps`. `profile_fit` is not persisted, so
 * batch recalculation skips it.
 */
export function predictionsFromSignals(signals, recentNotes = [], pdiGaps = null) {
  const turnover = turnoverRiskFromSignals(signals);
  return {
    turnover_risk: turnover.risk,
    turnover_reasons: turnover.reasons,
    turnover_score: turnover.score,
    pdi_gap_areas: pdiGaps || pdiGapsFromSignals(signals, recentNotes || []),
  };
}
