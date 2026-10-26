/**
 * B-1103 — Analytics: Comparativos (área, período, rubrica)
 * 
 * Compara métricas entre segmentos para identificar gaps e oportunidades.
 */

import { queryRead } from '../db.js';
import { computeAreaScore010 } from '../assessment/area-fit.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

const RUBRIC_COMPARE_CAP = 5000;
const COMPARISON_OPTIONS_CAP = 500;

/**
 * Compara HR Score entre duas áreas/departamentos
 * @param {number} companyId
 * @param {string} areaA - Nome da área A
 * @param {string} areaB - Nome da área B
 * @returns {Promise<{areaA, areaB, comparison}>}
 */
export async function compareAreas(companyId, areaA, areaB) {
  const sql = `
    SELECT
      ar.label AS area,
      AVG(hs.score) AS avg_hr_score,
      AVG(CASE WHEN hs.turnover_risk = 'high' THEN 1 ELSE 0 END) * 100 AS high_risk_pct,
      COUNT(DISTINCT c.id) AS count
    FROM candidates c
    LEFT JOIN hr_scores hs ON c.id = hs.candidate_id AND hs.company_id = c.company_id
    JOIN LATERAL (
      SELECT ass.area_id FROM assessments ass
      WHERE ass.candidate_id = c.id AND ass.company_id = c.company_id
      ORDER BY ass.created_at DESC, ass.id DESC LIMIT 1
    ) latest ON TRUE
    JOIN areas ar ON ar.id = latest.area_id
    WHERE c.company_id = $1
      AND ar.label IN ($2, $3)
      AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
    GROUP BY ar.label
  `;

  const result = await queryRead(sql, [companyId, areaA, areaB]);
  
  const dataA = result.rows.find(r => r.area === areaA) || { avg_hr_score: null, high_risk_pct: null, count: 0 };
  const dataB = result.rows.find(r => r.area === areaB) || { avg_hr_score: null, high_risk_pct: null, count: 0 };

  return {
    areaA: {
      name: areaA,
      avgHrScore: parseFloat(dataA.avg_hr_score) || 0,
      highRiskPct: parseFloat(dataA.high_risk_pct) || 0,
      count: parseInt(dataA.count) || 0,
    },
    areaB: {
      name: areaB,
      avgHrScore: parseFloat(dataB.avg_hr_score) || 0,
      highRiskPct: parseFloat(dataB.high_risk_pct) || 0,
      count: parseInt(dataB.count) || 0,
    },
    comparison: {
      hrScoreDelta: (parseFloat(dataA.avg_hr_score) || 0) - (parseFloat(dataB.avg_hr_score) || 0),
      riskDelta: (parseFloat(dataA.high_risk_pct) || 0) - (parseFloat(dataB.high_risk_pct) || 0),
    },
  };
}

/**
 * Compara métricas entre dois períodos
 * @param {number} companyId
 * @param {string} periodAStart - ISO date
 * @param {string} periodAEnd - ISO date
 * @param {string} periodBStart - ISO date
 * @param {string} periodBEnd - ISO date
 * @returns {Promise<{periodA, periodB, comparison}>}
 */
export async function comparePeriods(companyId, periodAStart, periodAEnd, periodBStart, periodBEnd) {
  const sqlA = `
    SELECT
      AVG(hs.score) AS avg_hr_score,
      COUNT(DISTINCT c.id) FILTER (WHERE c.hired_at BETWEEN $2 AND $3) AS hires,
      COUNT(DISTINCT er.id) FILTER (WHERE er.exit_date BETWEEN $2 AND $3) AS exits
    FROM candidates c
    LEFT JOIN hr_scores hs ON c.id = hs.candidate_id
      AND hs.calculated_at BETWEEN $2 AND $3
    LEFT JOIN exit_records er ON er.candidate_id = c.id AND er.company_id = c.company_id
    WHERE c.company_id = $1
  `;

  const sqlB = `
    SELECT
      AVG(hs.score) AS avg_hr_score,
      COUNT(DISTINCT c.id) FILTER (WHERE c.hired_at BETWEEN $2 AND $3) AS hires,
      COUNT(DISTINCT er.id) FILTER (WHERE er.exit_date BETWEEN $2 AND $3) AS exits
    FROM candidates c
    LEFT JOIN hr_scores hs ON c.id = hs.candidate_id
      AND hs.calculated_at BETWEEN $2 AND $3
    LEFT JOIN exit_records er ON er.candidate_id = c.id AND er.company_id = c.company_id
    WHERE c.company_id = $1
  `;

  const [resultA, resultB] = await Promise.all([
    queryRead(sqlA, [companyId, periodAStart, periodAEnd]),
    queryRead(sqlB, [companyId, periodBStart, periodBEnd]),
  ]);

  const dataA = resultA.rows[0] || {};
  const dataB = resultB.rows[0] || {};

  return {
    periodA: {
      start: periodAStart,
      end: periodAEnd,
      avgHrScore: parseFloat(dataA.avg_hr_score) || 0,
      hires: parseInt(dataA.hires) || 0,
      exits: parseInt(dataA.exits) || 0,
    },
    periodB: {
      start: periodBStart,
      end: periodBEnd,
      avgHrScore: parseFloat(dataB.avg_hr_score) || 0,
      hires: parseInt(dataB.hires) || 0,
      exits: parseInt(dataB.exits) || 0,
    },
    comparison: {
      hrScoreDelta: (parseFloat(dataA.avg_hr_score) || 0) - (parseFloat(dataB.avg_hr_score) || 0),
      netHireDelta: (parseInt(dataA.hires) - parseInt(dataA.exits)) - (parseInt(dataB.hires) - parseInt(dataB.exits)),
    },
  };
}

/**
 * Compara fit médio entre duas rubricas (job roles)
 * @param {number} companyId
 * @param {number} rubricAId - Job role ID A
 * @param {number} rubricBId - Job role ID B
 * @returns {Promise<{rubricA, rubricB, comparison}>}
 */
export async function compareRubrics(companyId, rubricAId, rubricBId) {
  const sql = `
    SELECT jr.id, jr.name AS title, a.scores, jr.rubric AS weights,
      (c.employment_status IN ('${EMPLOYMENT_STATUS.EMPLOYEE}', '${EMPLOYMENT_STATUS.ALUMNI}')
        AND c.hired_vacancy_id = a.vacancy_id) AS hired
    FROM job_roles jr
    LEFT JOIN vacancies v ON v.job_role_id = jr.id AND v.deleted = FALSE
    LEFT JOIN assessments a ON a.vacancy_id = v.id AND a.company_id = jr.company_id
    LEFT JOIN candidates c ON c.id = a.candidate_id AND c.company_id = jr.company_id
    WHERE jr.company_id = $1
      AND jr.id IN ($2, $3)
      AND jr.active = TRUE
    ORDER BY a.created_at DESC NULLS LAST, a.id DESC NULLS LAST
    LIMIT ${RUBRIC_COMPARE_CAP}
  `;

  const result = await queryRead(sql, [companyId, rubricAId, rubricBId]);

  const summarize = (id) => {
    const rows = result.rows.filter((row) => Number(row.id) === Number(id));
    const title = rows[0]?.title || 'Unknown';
    const scored = rows.map((row) => ({ score: computeAreaScore010(row.scores, row.weights).score010, hired: row.hired === true })).filter((row) => row.score != null);
    const hired = scored.filter((row) => row.hired);
    const avg = (values) => values.length ? values.reduce((sum, row) => sum + row.score, 0) / values.length : 0;
    return { id, title, avgFit: avg(scored), hiredCount: hired.length, hiredAvgFit: avg(hired) };
  };
  const dataA = summarize(rubricAId);
  const dataB = summarize(rubricBId);

  return {
    rubricA: {
      id: rubricAId,
      title: dataA.title,
      avgFit: dataA.avgFit,
      hiredCount: dataA.hiredCount,
      hiredAvgFit: dataA.hiredAvgFit,
    },
    rubricB: {
      id: rubricBId,
      title: dataB.title,
      avgFit: dataB.avgFit,
      hiredCount: dataB.hiredCount,
      hiredAvgFit: dataB.hiredAvgFit,
    },
    comparison: {
      avgFitDelta: dataA.avgFit - dataB.avgFit,
      hiredFitDelta: dataA.hiredAvgFit - dataB.hiredAvgFit,
    },
  };
}

/**
 * Lista áreas disponíveis para comparação
 * @param {number} companyId
 * @returns {Promise<Array<string>>}
 */
export async function listAvailableAreas(companyId) {
  const sql = `
    SELECT DISTINCT ar.label AS area
    FROM candidates c
    JOIN LATERAL (
      SELECT ass.area_id FROM assessments ass
      WHERE ass.candidate_id = c.id AND ass.company_id = c.company_id
      ORDER BY ass.created_at DESC, ass.id DESC LIMIT 1
    ) latest ON TRUE
    JOIN areas ar ON ar.id = latest.area_id
    WHERE c.company_id = $1
      AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
    ORDER BY ar.label
    LIMIT ${COMPARISON_OPTIONS_CAP}
  `;

  const result = await queryRead(sql, [companyId]);
  return result.rows.map(r => r.area);
}

/**
 * Lista rubricas (job roles) disponíveis para comparação
 * @param {number} companyId
 * @returns {Promise<Array<{id, title}>>}
 */
export async function listAvailableRubrics(companyId) {
  const sql = `
    SELECT id, name AS title
    FROM job_roles
    WHERE company_id = $1
      AND active = TRUE
    ORDER BY title
    LIMIT ${COMPARISON_OPTIONS_CAP}
  `;

  const result = await queryRead(sql, [companyId]);
  return result.rows.map(r => ({ id: r.id, title: r.title }));
}
