/**
 * B-1104 — Analytics: Alertas e detecção de anomalias
 * 
 * Detecta padrões anormais proativamente e gera notificações.
 */

import { queryRead } from '../db.js';
import { EMPLOYMENT_STATUS, VACANCY_STATUS } from '../domain-status.js';

/**
 * Thresholds configuráveis para alertas
 */
const ALERT_THRESHOLDS = {
  CLIMATE_DROP_PCT: 15,           // Queda de clima > 15% em 1 mês
  TURNOVER_RISK_INCREASE_PCT: 20, // Aumento de risco > 20% em 1 trimestre
  TIME_TO_HIRE_DAYS: 90,          // Time-to-hire > 90 dias
  HR_SCORE_LOW_THRESHOLD: 50,     // HR Score médio < 50
  PDI_COMPLETION_LOW_PCT: 30,     // PDI completion < 30%
};

/**
 * Detecta queda abrupta de clima
 * @param {number} companyId
 * @returns {Promise<{alert: boolean, data: object}>}
 */
export async function detectClimateDropAlert(companyId) {
  const sql = `
    WITH monthly_climate AS (
      SELECT
        DATE_TRUNC('month', cr.submitted_at) AS month,
        AVG((cr.answers ->> q.id::text)::numeric) FILTER (
          WHERE jsonb_typeof(cr.answers -> q.id::text) = 'number'
        ) AS avg_climate
      FROM climate_surveys cs
      INNER JOIN climate_survey_responses cr ON cs.id = cr.survey_id
      INNER JOIN climate_survey_questions q
        ON q.survey_id = cs.id AND q.active = TRUE AND q.question_kind = 'likert'
      WHERE cs.company_id = $1
        AND cs.deleted = FALSE
        AND cr.submitted_at >= NOW() - INTERVAL '2 months'
      GROUP BY DATE_TRUNC('month', cr.submitted_at)
      ORDER BY month DESC
      LIMIT 2
    )
    SELECT
      LAG(avg_climate) OVER (ORDER BY month DESC) AS previous_month,
      avg_climate AS current_month
    FROM monthly_climate
    LIMIT 1
  `;

  const result = await queryRead(sql, [companyId]);
  if (result.rowCount === 0) {
    return { alert: false };
  }

  const row = result.rows[0];
  const previous = parseFloat(row.previous_month);
  const current = parseFloat(row.current_month);

  if (!previous || !current) {
    return { alert: false };
  }

  const dropPct = ((previous - current) / previous) * 100;

  return {
    alert: dropPct > ALERT_THRESHOLDS.CLIMATE_DROP_PCT,
    data: {
      previousMonth: previous.toFixed(1),
      currentMonth: current.toFixed(1),
      dropPct: dropPct.toFixed(1),
    },
  };
}

/**
 * Detecta aumento de risco de turnover
 * @param {number} companyId
 * @returns {Promise<{alert: boolean, data: object}>}
 */
export async function detectTurnoverRiskIncreaseAlert(companyId) {
  const sql = `
    WITH quarterly_risk AS (
      SELECT
        DATE_TRUNC('quarter', hs.calculated_at) AS quarter,
        COUNT(*) FILTER (WHERE hs.turnover_risk = 'high') * 100.0 / COUNT(*) AS high_risk_pct
      FROM hr_scores hs
      INNER JOIN candidates c ON hs.candidate_id = c.id
      WHERE c.company_id = $1
        AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
        AND hs.calculated_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('quarter', hs.calculated_at)
      ORDER BY quarter DESC
      LIMIT 2
    )
    SELECT
      LAG(high_risk_pct) OVER (ORDER BY quarter DESC) AS previous_quarter,
      high_risk_pct AS current_quarter
    FROM quarterly_risk
    LIMIT 1
  `;

  const result = await queryRead(sql, [companyId]);
  if (result.rowCount === 0) {
    return { alert: false };
  }

  const row = result.rows[0];
  const previous = parseFloat(row.previous_quarter);
  const current = parseFloat(row.current_quarter);

  if (previous == null || current == null) {
    return { alert: false };
  }

  const increasePct = current - previous;

  return {
    alert: increasePct > ALERT_THRESHOLDS.TURNOVER_RISK_INCREASE_PCT,
    data: {
      previousQuarter: previous.toFixed(1),
      currentQuarter: current.toFixed(1),
      increasePct: increasePct.toFixed(1),
    },
  };
}

/**
 * Detecta vagas com time-to-hire excessivo
 * @param {number} companyId
 * @returns {Promise<{alert: boolean, data: object}>}
 */
export async function detectSlowVacanciesAlert(companyId) {
  const sql = `
    SELECT
      v.id,
      v.title,
      EXTRACT(DAY FROM (NOW() - v.created_at)) AS days_open
    FROM vacancies v
    WHERE v.company_id = $1
      AND v.deleted = FALSE
      AND v.status = '${VACANCY_STATUS.OPEN}'
      AND EXTRACT(DAY FROM (NOW() - v.created_at)) > $2
    ORDER BY days_open DESC
    LIMIT 5
  `;

  const result = await queryRead(sql, [companyId, ALERT_THRESHOLDS.TIME_TO_HIRE_DAYS]);

  return {
    alert: result.rowCount > 0,
    data: {
      count: result.rowCount,
      vacancies: result.rows.map(r => ({
        id: r.id,
        title: r.title,
        daysOpen: parseInt(r.days_open),
      })),
    },
  };
}

/**
 * Detecta HR Score médio baixo (empresa)
 * @param {number} companyId
 * @returns {Promise<{alert: boolean, data: object}>}
 */
export async function detectLowHrScoreAlert(companyId) {
  const sql = `
    SELECT AVG(hs.score) AS avg_score
    FROM hr_scores hs
    INNER JOIN candidates c ON hs.candidate_id = c.id
    WHERE c.company_id = $1
      AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
  `;

  const result = await queryRead(sql, [companyId]);
  const avgScore = parseFloat(result.rows[0]?.avg_score || 0);

  return {
    alert: avgScore > 0 && avgScore < ALERT_THRESHOLDS.HR_SCORE_LOW_THRESHOLD,
    data: {
      avgScore: avgScore.toFixed(1),
      threshold: ALERT_THRESHOLDS.HR_SCORE_LOW_THRESHOLD,
    },
  };
}

/**
 * Executa todas as detecções e retorna alertas ativos
 * @param {number} companyId
 * @returns {Promise<Array<{type, message, data}>>}
 */
export async function detectAllAlerts(companyId) {
  const [climateDrop, turnoverIncrease, slowVacancies, lowHrScore] = await Promise.all([
    detectClimateDropAlert(companyId),
    detectTurnoverRiskIncreaseAlert(companyId),
    detectSlowVacanciesAlert(companyId),
    detectLowHrScoreAlert(companyId),
  ]);

  const alerts = [];

  if (climateDrop.alert) {
    alerts.push({
      type: 'climate_drop',
      severity: 'high',
      message: `Clima caiu ${climateDrop.data.dropPct}% no último mês`,
      data: climateDrop.data,
    });
  }

  if (turnoverIncrease.alert) {
    alerts.push({
      type: 'turnover_increase',
      severity: 'high',
      message: `Risco de turnover aumentou ${turnoverIncrease.data.increasePct}% no trimestre`,
      data: turnoverIncrease.data,
    });
  }

  if (slowVacancies.alert) {
    alerts.push({
      type: 'slow_vacancies',
      severity: 'medium',
      message: `${slowVacancies.data.count} vagas abertas há mais de ${ALERT_THRESHOLDS.TIME_TO_HIRE_DAYS} dias`,
      data: slowVacancies.data,
    });
  }

  if (lowHrScore.alert) {
    alerts.push({
      type: 'low_hr_score',
      severity: 'medium',
      message: `HR Score médio da empresa está em ${lowHrScore.data.avgScore}/100`,
      data: lowHrScore.data,
    });
  }

  return alerts;
}
