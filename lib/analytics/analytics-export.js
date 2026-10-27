/**
 * B-1105 — Analytics: Export estruturado (JSON/Excel)
 * 
 * Estende export-assessments-csv.js para suportar formatos ricos.
 */

/**
 * Gera export JSON estruturado de métricas
 * @param {object} metrics - Resultado de getHiringEffectivenessMetrics
 * @param {object} filters - Filtros aplicados
 * @returns {string} JSON formatado
 */
export function exportMetricsToJSON(metrics, filters = {}) {
  const exportData = {
    metadata: {
      exportedAt: new Date().toISOString(),
      filters,
      version: '1.0',
    },
    metrics: {
      timeToHire: {
        avgDays: metrics.timeToHire.avgDays,
        count: metrics.timeToHire.count,
        trend: metrics.timeToHire.trend,
      },
      timeToProductivity: {
        avgDays: metrics.timeToProductivity.avgDays,
        count: metrics.timeToProductivity.count,
      },
      retention: {
        sixMonths: {
          rate: metrics.retention.sixMonths.rate,
          retained: metrics.retention.sixMonths.retainedCount,
          hired: metrics.retention.sixMonths.hiredCount,
        },
        twelveMonths: {
          rate: metrics.retention.twelveMonths.rate,
          retained: metrics.retention.twelveMonths.retainedCount,
          hired: metrics.retention.twelveMonths.hiredCount,
        },
      },
      fitComparison: {
        hiredAvgFit: metrics.fitComparison.hiredAvgFit,
        poolAvgFit: metrics.fitComparison.poolAvgFit,
        delta: metrics.fitComparison.delta,
        hiredCount: metrics.fitComparison.hiredCount,
        poolCount: metrics.fitComparison.poolCount,
      },
      rubricAdherence: {
        avgAdherence: metrics.rubricAdherence.avgAdherence,
        count: metrics.rubricAdherence.count,
      },
    },
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Gera CSV simples de métricas (fallback)
 * @param {object} metrics
 * @returns {string} CSV
 */
export function exportMetricsToCSV(metrics) {
  const rows = [
    ['Métrica', 'Valor', 'Unidade', 'N'],
    ['Time-to-Hire', metrics.timeToHire.avgDays, 'dias', metrics.timeToHire.count],
    ['Time-to-Productivity', metrics.timeToProductivity.avgDays, 'dias', metrics.timeToProductivity.count],
    ['Retenção 6m', metrics.retention.sixMonths.rate, '%', metrics.retention.sixMonths.hiredCount],
    ['Retenção 12m', metrics.retention.twelveMonths.rate, '%', metrics.retention.twelveMonths.hiredCount],
    ['Fit Médio Contratados', metrics.fitComparison.hiredAvgFit, '/10', metrics.fitComparison.hiredCount],
    ['Fit Médio Pool', metrics.fitComparison.poolAvgFit, '/10', metrics.fitComparison.poolCount],
    ['Aderência Rubrica', metrics.rubricAdherence.avgAdherence, '/10', metrics.rubricAdherence.count],
  ];

  return rows.map(r => r.join(',')).join('\n');
}

/**
 * Gera export JSON de tendências
 * @param {object} trends - Resultado de getAllTrends
 * @returns {string} JSON formatado
 */
export function exportTrendsToJSON(trends) {
  return JSON.stringify({
    metadata: {
      exportedAt: new Date().toISOString(),
      type: 'trends',
    },
    trends,
  }, null, 2);
}
