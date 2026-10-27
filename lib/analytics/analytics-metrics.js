/**
 * B-1101 — Analytics: métricas de efetividade (hiring ROI)
 * 
 * Calcula métricas de impacto real do processo seletivo:
 * - Time-to-hire
 * - Time-to-productivity
 * - Taxa de retenção
 * - Fit médio contratados vs pool
 * - Aderência rubrica
 */

import { queryRead } from '../db.js';
import { computeAreaScore010 } from '../assessment/area-fit.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

const FIT_ANALYTICS_CAP = 5000;

/**
 * Calcula time-to-hire (dias: vaga aberta → contratação)
 * @param {number} companyId
 * @param {object} opts - { startDate, endDate, vacancyId }
 * @returns {Promise<{ avgDays: number, count: number, trend: number }>}
 */
export async function getTimeToHire(companyId, opts = {}) {
  const { startDate, endDate, vacancyId } = opts;
  
  let whereClauses = ['v.company_id = $1', 'v.deleted = FALSE'];
  let params = [companyId];
  let paramIdx = 2;

  if (vacancyId) {
    whereClauses.push(`v.id = $${paramIdx}`);
    params.push(vacancyId);
    paramIdx++;
  }

  if (startDate) {
    whereClauses.push(`c.hired_at >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    whereClauses.push(`c.hired_at <= $${paramIdx}`);
    params.push(endDate);
    paramIdx++;
  }

  const sql = `
    SELECT
      AVG(EXTRACT(EPOCH FROM (c.hired_at - v.created_at)) / 86400.0) AS avg_days,
      COUNT(*) AS count
    FROM candidates c
    INNER JOIN vacancies v ON c.hired_vacancy_id = v.id
    WHERE ${whereClauses.join(' AND ')}
      AND c.hired_at IS NOT NULL
  `;

  const result = await queryRead(sql, params);
  const row = result.rows[0];

  // Calcular trend (comparar com período anterior)
  let trend = 0;
  if (startDate && endDate) {
    const duration = new Date(endDate) - new Date(startDate);
    const previousStart = new Date(new Date(startDate) - duration);
    const previousEnd = new Date(startDate);

    const trendSql = `
      SELECT AVG(EXTRACT(EPOCH FROM (c.hired_at - v.created_at)) / 86400.0) AS avg_days
      FROM candidates c
      INNER JOIN vacancies v ON c.hired_vacancy_id = v.id
      WHERE v.company_id = $1
        AND v.deleted = FALSE
        AND c.hired_at IS NOT NULL
        AND c.hired_at >= $2
        AND c.hired_at < $3
    `;
    const trendResult = await queryRead(trendSql, [companyId, previousStart.toISOString(), previousEnd.toISOString()]);
    const previousAvg = parseFloat(trendResult.rows[0]?.avg_days || 0);
    const currentAvg = parseFloat(row.avg_days || 0);
    
    if (previousAvg > 0) {
      trend = ((currentAvg - previousAvg) / previousAvg) * 100;
    }
  }

  return {
    avgDays: Math.round(parseFloat(row.avg_days || 0)),
    count: parseInt(row.count || 0),
    trend: Math.round(trend * 10) / 10, // 1 decimal
  };
}

/**
 * Calcula time-to-productivity (dias até HR Score > 60)
 * @param {number} companyId
 * @param {object} opts - { startDate, endDate }
 * @returns {Promise<{ avgDays: number, count: number }>}
 */
export async function getTimeToProductivity(companyId, opts = {}) {
  const { startDate, endDate } = opts;
  
  let whereClauses = ['c.company_id = $1', 'c.hired_at IS NOT NULL'];
  let params = [companyId];
  let paramIdx = 2;

  if (startDate) {
    whereClauses.push(`c.hired_at >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    whereClauses.push(`c.hired_at <= $${paramIdx}`);
    params.push(endDate);
    paramIdx++;
  }

  const sql = `
    SELECT
      AVG(
        (SELECT MIN(EXTRACT(EPOCH FROM (hs.calculated_at - c.hired_at)) / 86400.0)
         FROM hr_scores hs
         WHERE hs.candidate_id = c.id
           AND hs.score > 60
           AND hs.calculated_at > c.hired_at
        )
      ) AS avg_days,
      COUNT(*) AS count
    FROM candidates c
    WHERE ${whereClauses.join(' AND ')}
      AND EXISTS (
        SELECT 1 FROM hr_scores hs2
        WHERE hs2.candidate_id = c.id
          AND hs2.score > 60
          AND hs2.calculated_at > c.hired_at
      )
  `;

  const result = await queryRead(sql, params);
  const row = result.rows[0];

  return {
    avgDays: Math.round(parseFloat(row.avg_days || 0)),
    count: parseInt(row.count || 0),
  };
}

/**
 * Calcula taxa de retenção (% contratados que ficam N meses)
 * @param {number} companyId
 * @param {object} opts - { months: 6|12|24, startDate, endDate }
 * @returns {Promise<{ rate: number, hiredCount: number, retainedCount: number }>}
 */
export async function getRetentionRate(companyId, opts = {}) {
  const { months = 6, startDate, endDate } = opts;
  
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);

  let whereClauses = ['c.company_id = $1', 'c.hired_at IS NOT NULL', `c.hired_at <= $2`];
  let params = [companyId, cutoffDate.toISOString(), months];
  let paramIdx = 4;

  if (startDate) {
    whereClauses.push(`c.hired_at >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    whereClauses.push(`c.hired_at <= $${paramIdx}`);
    params.push(endDate);
    paramIdx++;
  }

  const sql = `
    SELECT
      COUNT(*) AS hired_count,
      COUNT(*) FILTER (
        WHERE er.exit_date IS NULL
          OR er.exit_date > (c.hired_at + ($3::int * INTERVAL '1 month'))
      ) AS retained_count
    FROM candidates c
    LEFT JOIN exit_records er
      ON er.candidate_id = c.id AND er.company_id = c.company_id
    WHERE ${whereClauses.join(' AND ')}
  `;

  const result = await queryRead(sql, params);
  const row = result.rows[0];
  const hiredCount = parseInt(row.hired_count || 0);
  const retainedCount = parseInt(row.retained_count || 0);

  const rate = hiredCount > 0 ? (retainedCount / hiredCount) * 100 : 0;

  return {
    rate: Math.round(rate * 10) / 10,
    hiredCount,
    retainedCount,
  };
}

/**
 * Calcula fit médio de contratados vs pool total
 * @param {number} companyId
 * @param {object} opts - { startDate, endDate, vacancyId }
 * @returns {Promise<{ hiredAvgFit: number, poolAvgFit: number, delta: number }>}
 */
async function getFitAnalytics(companyId, opts = {}) {
  const { startDate, endDate, vacancyId } = opts;
  
  let whereClauses = ['a.company_id = $1', 'a.vacancy_id IS NOT NULL'];
  let params = [companyId];
  let paramIdx = 2;

  if (vacancyId) {
    whereClauses.push(`a.vacancy_id = $${paramIdx}`);
    params.push(vacancyId);
    paramIdx++;
  }

  if (startDate) {
    whereClauses.push(`a.created_at >= $${paramIdx}`);
    params.push(startDate);
    paramIdx++;
  }

  if (endDate) {
    whereClauses.push(`a.created_at <= $${paramIdx}`);
    params.push(endDate);
    paramIdx++;
  }

  const sql = `
    SELECT a.scores, vr.desired_type_weights AS weights,
           (c.employment_status IN ('${EMPLOYMENT_STATUS.EMPLOYEE}', '${EMPLOYMENT_STATUS.ALUMNI}')
             AND c.hired_vacancy_id = a.vacancy_id) AS hired
    FROM assessments a
    JOIN candidates c ON c.id = a.candidate_id AND c.company_id = a.company_id
    JOIN vacancy_rubrics vr ON vr.vacancy_id = a.vacancy_id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${FIT_ANALYTICS_CAP}
  `;

  const result = await queryRead(sql, params);
  const scored = result.rows.map((row) => ({
    score: computeAreaScore010(row.scores, row.weights).score010,
    hired: row.hired === true,
  })).filter((row) => row.score != null);
  const hired = scored.filter((row) => row.hired);
  const average = (rows) => rows.length ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;
  const hiredAvgFit = average(hired);
  const poolAvgFit = average(scored);
  const delta = hiredAvgFit - poolAvgFit;

  return {
    fitComparison: {
      hiredAvgFit: Math.round(hiredAvgFit * 10) / 10,
      poolAvgFit: Math.round(poolAvgFit * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      hiredCount: hired.length,
      poolCount: scored.length,
      truncated: result.rowCount >= FIT_ANALYTICS_CAP,
    },
    rubricAdherence: {
      avgAdherence: Math.round(hiredAvgFit * 10) / 10,
      count: hired.length,
    },
  };
}

export async function getFitComparison(companyId, opts = {}) {
  return (await getFitAnalytics(companyId, opts)).fitComparison;
}

/**
 * Calcula aderência rubrica (fit T1-T9 contratados vs expectativa)
 * @param {number} companyId
 * @param {object} opts - { startDate, endDate, vacancyId }
 * @returns {Promise<{ avgAdherence: number, count: number }>}
 */
export async function getRubricAdherence(companyId, opts = {}) {
  return (await getFitAnalytics(companyId, opts)).rubricAdherence;
}

/**
 * Agrega todas as métricas de efetividade
 * @param {number} companyId
 * @param {object} opts - { startDate, endDate, vacancyId }
 * @returns {Promise<object>}
 */
export async function getHiringEffectivenessMetrics(companyId, opts = {}) {
  const [
    timeToHire,
    timeToProductivity,
    retention6m,
    retention12m,
    fitAnalytics,
  ] = await Promise.all([
    getTimeToHire(companyId, opts),
    getTimeToProductivity(companyId, opts),
    getRetentionRate(companyId, { ...opts, months: 6 }),
    getRetentionRate(companyId, { ...opts, months: 12 }),
    getFitAnalytics(companyId, opts),
  ]);

  return {
    timeToHire,
    timeToProductivity,
    retention: {
      sixMonths: retention6m,
      twelveMonths: retention12m,
    },
    fitComparison: fitAnalytics.fitComparison,
    rubricAdherence: fitAnalytics.rubricAdherence,
    sampleSize: {
      hires: timeToHire.count,
      productivityRecords: timeToProductivity.count,
      retention6m: retention6m.hiredCount,
      retention12m: retention12m.hiredCount,
      hiredFit: fitAnalytics.fitComparison.hiredCount,
      poolFit: fitAnalytics.fitComparison.poolCount,
    },
  };
}
