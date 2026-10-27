/**
 * B-1102 — Analytics: Tendências temporais (time series)
 * 
 * Gráficos de evolução ao longo do tempo para métricas-chave.
 * Agregação mensal dos últimos 12-24 meses.
 */

import { queryRead } from '../db.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

/**
 * Gera array de meses (últimos N meses)
 * @param {number} months - Quantidade de meses
 * @returns {Array<{month: string, startDate: Date, endDate: Date}>}
 */
function generateMonthRange(months = 12) {
  const result = [];
  const now = new Date();
  
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    
    result.push({
      month: date.toISOString().slice(0, 7), // "YYYY-MM"
      startDate: date,
      endDate: nextMonth,
    });
  }
  
  return result;
}

/**
 * Tendência: HR Score médio do time (mensal)
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<Array<{month, avgScore, count}>>}
 */
export async function getHrScoreTrend(companyId, opts = {}) {
  const { months = 12 } = opts;
  const monthRange = generateMonthRange(months);
  
  const sql = `
    WITH monthly_scores AS (
      SELECT
        DATE_TRUNC('month', hs.calculated_at) AS month,
        AVG(hs.score) AS avg_score,
        COUNT(DISTINCT hs.candidate_id) AS count
      FROM hr_scores hs
      INNER JOIN candidates c ON hs.candidate_id = c.id
      WHERE c.company_id = $1
        AND c.employment_status IN ('${EMPLOYMENT_STATUS.EMPLOYEE}', '${EMPLOYMENT_STATUS.ALUMNI}')
        AND NOT EXISTS (SELECT 1 FROM exit_records er WHERE er.candidate_id = c.id AND er.exit_date <= hs.calculated_at)
        AND hs.calculated_at >= $2
      GROUP BY DATE_TRUNC('month', hs.calculated_at)
    )
    SELECT
      TO_CHAR(month, 'YYYY-MM') AS month,
      ROUND(avg_score::numeric, 1) AS avg_score,
      count
    FROM monthly_scores
    ORDER BY month
  `;
  
  const startDate = monthRange[0].startDate;
  const result = await queryRead(sql, [companyId, startDate]);
  
  // Preencher meses sem dados com null
  const dataMap = new Map(result.rows.map(r => [r.month, r]));
  
  return monthRange.map(({ month }) => ({
    month,
    avgScore: dataMap.get(month)?.avg_score || null,
    count: parseInt(dataMap.get(month)?.count || 0),
  }));
}

/**
 * Tendência: Turnover risk (% alto risco, mensal)
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<Array<{month, highRiskPct, mediumRiskPct, count}>>}
 */
export async function getTurnoverRiskTrend(companyId, opts = {}) {
  const { months = 12 } = opts;
  const monthRange = generateMonthRange(months);
  
  const sql = `
    WITH monthly_risk AS (
      SELECT
        DATE_TRUNC('month', hs.calculated_at) AS month,
        COUNT(*) FILTER (WHERE hs.turnover_risk = 'high') AS high_risk,
        COUNT(*) FILTER (WHERE hs.turnover_risk = 'medium') AS medium_risk,
        COUNT(*) AS total
      FROM hr_scores hs
      INNER JOIN candidates c ON hs.candidate_id = c.id
      WHERE c.company_id = $1
        AND c.employment_status IN ('${EMPLOYMENT_STATUS.EMPLOYEE}', '${EMPLOYMENT_STATUS.ALUMNI}')
        AND NOT EXISTS (SELECT 1 FROM exit_records er WHERE er.candidate_id = c.id AND er.exit_date <= hs.calculated_at)
        AND hs.calculated_at >= $2
      GROUP BY DATE_TRUNC('month', hs.calculated_at)
    )
    SELECT
      TO_CHAR(month, 'YYYY-MM') AS month,
      ROUND((high_risk::numeric / NULLIF(total, 0)) * 100, 1) AS high_risk_pct,
      ROUND((medium_risk::numeric / NULLIF(total, 0)) * 100, 1) AS medium_risk_pct,
      total AS count
    FROM monthly_risk
    ORDER BY month
  `;
  
  const startDate = monthRange[0].startDate;
  const result = await queryRead(sql, [companyId, startDate]);
  
  const dataMap = new Map(result.rows.map(r => [r.month, r]));
  
  return monthRange.map(({ month }) => ({
    month,
    highRiskPct: parseFloat(dataMap.get(month)?.high_risk_pct || 0),
    mediumRiskPct: parseFloat(dataMap.get(month)?.medium_risk_pct || 0),
    count: parseInt(dataMap.get(month)?.count || 0),
  }));
}

/**
 * Tendência: Clima médio (mensal)
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<Array<{month, avgClimate, responseCount}>>}
 */
export async function getClimateTrend(companyId, opts = {}) {
  const { months = 12 } = opts;
  const monthRange = generateMonthRange(months);
  
  const sql = `
    WITH monthly_climate AS (
      SELECT
        DATE_TRUNC('month', cr.submitted_at) AS month,
        AVG((cr.answers ->> q.id::text)::numeric) FILTER (
          WHERE jsonb_typeof(cr.answers -> q.id::text) = 'number'
        ) AS avg_climate,
        COUNT(DISTINCT cr.id) AS response_count
      FROM climate_surveys cs
      INNER JOIN climate_survey_responses cr ON cs.id = cr.survey_id
      INNER JOIN climate_survey_questions q
        ON q.survey_id = cs.id AND q.active = TRUE AND q.question_kind = 'likert'
      WHERE cs.company_id = $1
        AND cs.deleted = FALSE
        AND cr.submitted_at >= $2
      GROUP BY DATE_TRUNC('month', cr.submitted_at)
    )
    SELECT
      TO_CHAR(month, 'YYYY-MM') AS month,
      ROUND(avg_climate::numeric, 1) AS avg_climate,
      response_count
    FROM monthly_climate
    ORDER BY month
  `;
  
  const startDate = monthRange[0].startDate;
  const result = await queryRead(sql, [companyId, startDate]);
  
  const dataMap = new Map(result.rows.map(r => [r.month, r]));
  
  return monthRange.map(({ month }) => ({
    month,
    avgClimate: parseFloat(dataMap.get(month)?.avg_climate || 0),
    responseCount: parseInt(dataMap.get(month)?.response_count || 0),
  }));
}

/**
 * Tendência: PDI completion rate (mensal)
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<Array<{month, completionRate, activePlans}>>}
 */
export async function getPdiCompletionTrend(companyId, opts = {}) {
  const { months = 12 } = opts;
  const monthRange = generateMonthRange(months);
  
  const sql = `
    WITH monthly_pdi AS (
      SELECT
        DATE_TRUNC('month', dp.created_at) AS month,
        COUNT(DISTINCT dp.id) FILTER (WHERE dp.status = 'completed') AS completed,
        COUNT(DISTINCT dp.id) AS total
      FROM development_plans dp
      INNER JOIN candidates c ON dp.candidate_id = c.id
      WHERE c.company_id = $1
        AND dp.created_at >= $2
      GROUP BY DATE_TRUNC('month', dp.created_at)
    )
    SELECT
      TO_CHAR(month, 'YYYY-MM') AS month,
      ROUND((completed::numeric / NULLIF(total, 0)) * 100, 1) AS completion_rate,
      total AS active_plans
    FROM monthly_pdi
    ORDER BY month
  `;
  
  const startDate = monthRange[0].startDate;
  const result = await queryRead(sql, [companyId, startDate]);
  
  const dataMap = new Map(result.rows.map(r => [r.month, r]));
  
  return monthRange.map(({ month }) => ({
    month,
    completionRate: parseFloat(dataMap.get(month)?.completion_rate || 0),
    activePlans: parseInt(dataMap.get(month)?.active_plans || 0),
  }));
}

/**
 * Tendência: Contratações vs Desligamentos (mensal)
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<Array<{month, hires, exits, netChange}>>}
 */
export async function getHiresVsExitsTrend(companyId, opts = {}) {
  const { months = 12 } = opts;
  const monthRange = generateMonthRange(months);
  
  const sql = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', hired_at), 'YYYY-MM') AS month,
      COUNT(*) AS hires
    FROM candidates
    WHERE company_id = $1
      AND hired_at IS NOT NULL
      AND hired_at >= $2
    GROUP BY DATE_TRUNC('month', hired_at)
  `;
  
  const exitsSql = `
    SELECT
      TO_CHAR(DATE_TRUNC('month', exit_date), 'YYYY-MM') AS month,
      COUNT(*) AS exits
    FROM exit_records
    WHERE company_id = $1
      AND exit_date >= $2
    GROUP BY DATE_TRUNC('month', exit_date)
  `;
  
  const startDate = monthRange[0].startDate;
  const [hiresResult, exitsResult] = await Promise.all([
    queryRead(sql, [companyId, startDate]),
    queryRead(exitsSql, [companyId, startDate]),
  ]);
  
  const hiresMap = new Map(hiresResult.rows.map(r => [r.month, parseInt(r.hires)]));
  const exitsMap = new Map(exitsResult.rows.map(r => [r.month, parseInt(r.exits)]));
  
  return monthRange.map(({ month }) => {
    const hires = hiresMap.get(month) || 0;
    const exits = exitsMap.get(month) || 0;
    return {
      month,
      hires,
      exits,
      netChange: hires - exits,
    };
  });
}

/**
 * Agrega todas as tendências
 * @param {number} companyId
 * @param {object} opts - { months: 12 }
 * @returns {Promise<object>}
 */
export async function getAllTrends(companyId, opts = {}) {
  const [
    hrScoreTrend,
    turnoverRiskTrend,
    climateTrend,
    pdiCompletionTrend,
    hiresVsExitsTrend,
  ] = await Promise.all([
    getHrScoreTrend(companyId, opts),
    getTurnoverRiskTrend(companyId, opts),
    getClimateTrend(companyId, opts),
    getPdiCompletionTrend(companyId, opts),
    getHiresVsExitsTrend(companyId, opts),
  ]);

  return {
    hrScore: hrScoreTrend,
    turnoverRisk: turnoverRiskTrend,
    climate: climateTrend,
    pdiCompletion: pdiCompletionTrend,
    hiresVsExits: hiresVsExitsTrend,
  };
}
