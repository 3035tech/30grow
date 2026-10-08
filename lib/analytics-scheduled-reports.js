import { runtimeAppUrl } from './app-url.js';
/**
 * B-1107 — Relatórios agendados de Analytics
 * Digest periódico (semanal/mensal) com métricas + alertas inline (HTML email)
 */

import { asDb } from './ae/as-db.js';
import { sendTransactionalMail, isMailConfigured } from './mail.js';
import { getHiringEffectivenessMetrics } from './analytics-metrics.js';
import { getAllTrends } from './analytics-trends.js';
import { detectAllAlerts } from './analytics-alerts.js';
import { getAnalyticsReportPrefs } from './analytics-report-prefs.js';
import { buildSimplePdf } from './simple-pdf.js';
import { t as i18nT, contentLocale } from './i18n.js';

const COMPANIES_CAP = 50; // Máximo de empresas por execução

function appBaseUrl() {
  return String(runtimeAppUrl() || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Formata número com 1 casa decimal
 */
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

/**
 * Formata porcentagem (0.85 → 85%)
 */
function pct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

/**
 * Gera HTML do relatório de Analytics para uma empresa
 */
function generateReportHTML(companyId, companyName, metrics, trends, alerts, locale = 'pt-BR') {
  const baseUrl = appBaseUrl();
  const dashboardUrl = `${baseUrl}/dashboard?tab=analytics`;

  const labels = contentLocale(locale) === 'en' ? {
    title: '30Grow Analytics Report',
    subtitle: 'Weekly summary of key metrics and alerts',
    metricsTitle: 'Hiring Effectiveness Metrics',
    timeToHire: 'Time-to-Hire',
    retention6m: 'Retention 6m',
    retention12m: 'Retention 12m',
    hiredFit: 'Hired Avg Fit',
    poolFit: 'Pool Avg Fit',
    trendsTitle: 'Trends (last 3 months)',
    hrScore: 'HR Score',
    turnover: 'Turnover Risk (high %)',
    climate: 'Climate',
    alertsTitle: 'Active Alerts',
    noAlerts: 'No alerts detected',
    viewDashboard: 'View full dashboard',
    footer: 'This is an automated report. Adjust frequency or PDF in Analytics → Scheduled report.',
    days: 'days',
    month: 'Month',
  } : {
    title: 'Relatório Analytics 30Grow',
    subtitle: 'Resumo semanal de métricas-chave e alertas',
    metricsTitle: 'Métricas de Efetividade (Recrutamento)',
    timeToHire: 'Time-to-Hire',
    retention6m: 'Retenção 6m',
    retention12m: 'Retenção 12m',
    hiredFit: 'Fit Médio Contratados',
    poolFit: 'Fit Médio Pool',
    trendsTitle: 'Tendências (últimos 3 meses)',
    hrScore: 'HR Score',
    turnover: 'Risco Rotatividade (% alto)',
    climate: 'Clima',
    alertsTitle: 'Alertas Ativos',
    noAlerts: 'Nenhum alerta detectado',
    viewDashboard: 'Ver dashboard completo',
    footer: 'Este é um relatório automatizado. Ajuste frequência ou PDF em Analytics → Relatório agendado.',
    days: 'dias',
    month: 'Mês',
  };

  // Métricas
  const timeToHireAvg = metrics?.timeToHire?.avgDays || null;
  const retention6m = metrics?.retentionRate?.at6Months || null;
  const retention12m = metrics?.retentionRate?.at12Months || null;
  const hiredAvgFit = metrics?.fitComparison?.hiredAvgFit || null;
  const poolAvgFit = metrics?.fitComparison?.poolAvgFit || null;

  // Tendências (últimos 3 pontos)
  const hrScoreTrend = trends?.hrScore?.slice(-3) || [];
  const turnoverTrend = trends?.turnoverRisk?.slice(-3) || [];
  const climateTrend = trends?.climate?.slice(-3) || [];

  // Alertas
  const alertsList = alerts || [];

  const html = `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${labels.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f9fafb;
      margin: 0;
      padding: 20px;
      color: #1f2937;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: #111827;
      color: #ffffff;
      padding: 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0 0 4px 0;
      font-size: 24px;
      font-weight: 600;
    }
    .header p {
      margin: 0;
      font-size: 14px;
      opacity: 0.9;
    }
    .section {
      padding: 24px;
      border-bottom: 1px solid #e5e7eb;
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 16px 0;
      color: #111827;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .metric-card {
      background: #f9fafb;
      border-radius: 6px;
      padding: 12px;
    }
    .metric-label {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
    }
    .metric-unit {
      font-size: 14px;
      color: #6b7280;
      margin-left: 4px;
    }
    .trend-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .trend-table th {
      text-align: left;
      padding: 8px;
      background: #f9fafb;
      font-weight: 600;
      color: #6b7280;
      font-size: 12px;
      text-transform: uppercase;
    }
    .trend-table td {
      padding: 8px;
      border-top: 1px solid #e5e7eb;
    }
    .alert-item {
      background: #fef2f2;
      border-left: 4px solid #dc2626;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    .alert-item:last-child {
      margin-bottom: 0;
    }
    .alert-item.warning {
      background: #fffbeb;
      border-left-color: #f59e0b;
    }
    .alert-item.info {
      background: #eff6ff;
      border-left-color: #3b82f6;
    }
    .alert-type {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: #dc2626;
      margin-bottom: 4px;
    }
    .alert-item.warning .alert-type {
      color: #d97706;
    }
    .alert-item.info .alert-type {
      color: #2563eb;
    }
    .alert-message {
      font-size: 14px;
      color: #1f2937;
      margin: 0;
    }
    .cta-button {
      display: inline-block;
      background: #15803D;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      margin-top: 16px;
    }
    .cta-button:hover {
      background: #166534;
    }
    .footer {
      padding: 16px 24px;
      background: #f9fafb;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
    }
    .no-data {
      color: #9ca3af;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${labels.title}</h1>
      <p>${labels.subtitle}</p>
      <p style="font-size: 12px; margin-top: 8px;">${companyName}</p>
    </div>

    <!-- Métricas -->
    <div class="section">
      <h2 class="section-title">${labels.metricsTitle}</h2>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">${labels.timeToHire}</div>
          <div class="metric-value">${timeToHireAvg != null ? Math.round(timeToHireAvg) : '—'}<span class="metric-unit">${labels.days}</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${labels.retention6m}</div>
          <div class="metric-value">${pct(retention6m)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${labels.retention12m}</div>
          <div class="metric-value">${pct(retention12m)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">${labels.hiredFit} / ${labels.poolFit}</div>
          <div class="metric-value">${fmt(hiredAvgFit)} / ${fmt(poolAvgFit)}</div>
        </div>
      </div>
    </div>

    <!-- Tendências -->
    <div class="section">
      <h2 class="section-title">${labels.trendsTitle}</h2>
      ${hrScoreTrend.length > 0 || turnoverTrend.length > 0 || climateTrend.length > 0 ? `
      <table class="trend-table">
        <thead>
          <tr>
            <th>${labels.month}</th>
            <th>${labels.hrScore}</th>
            <th>${labels.turnover}</th>
            <th>${labels.climate}</th>
          </tr>
        </thead>
        <tbody>
          ${Math.max(hrScoreTrend.length, turnoverTrend.length, climateTrend.length) > 0 ? 
            Array.from({ length: 3 }).map((_, i) => {
              const hs = hrScoreTrend[i];
              const tr = turnoverTrend[i];
              const cl = climateTrend[i];
              const month = hs?.month || tr?.month || cl?.month || '—';
              return `
              <tr>
                <td>${month}</td>
                <td>${hs ? fmt(hs.avgScore) : '—'}</td>
                <td>${tr ? pct(tr.highRiskPct) : '—'}</td>
                <td>${cl ? fmt(cl.avgScore) : '—'}</td>
              </tr>
              `;
            }).join('') 
            : '<tr><td colspan="4" class="no-data">Sem dados</td></tr>'
          }
        </tbody>
      </table>
      ` : '<p class="no-data">Sem tendências disponíveis</p>'}
    </div>

    <!-- Alertas -->
    <div class="section">
      <h2 class="section-title">${labels.alertsTitle}</h2>
      ${alertsList.length > 0 ? alertsList.map(alert => {
        const severity = alert.severity === 'high' ? '' : alert.severity === 'medium' ? 'warning' : 'info';
        return `
        <div class="alert-item ${severity}">
          <div class="alert-type">${alert.type.replace(/_/g, ' ')}</div>
          <p class="alert-message">${alert.message}</p>
        </div>
        `;
      }).join('') : `<p class="no-data">${labels.noAlerts}</p>`}
    </div>

    <!-- CTA -->
    <div class="section" style="text-align: center;">
      <a href="${dashboardUrl}" class="cta-button">${labels.viewDashboard}</a>
    </div>

    <!-- Footer -->
    <div class="footer">
      ${labels.footer}
    </div>
  </div>
</body>
</html>
  `.trim();

  return html;
}

/**
 * Executa o envio de relatórios agendados para empresas ativas.
 * @param {object} dbFn
 * @param {{ sendEmail?: boolean, locale?: string, frequency?: 'weekly'|'monthly'|'all', force?: boolean }} opts
 *   frequency — filtra prefs (default weekly). Cron semanal passa weekly; mensal passa monthly.
 */
export async function runScheduledAnalyticsReports(dbFn, opts = {}) {
  const db = asDb(dbFn);
  const { sendEmail = true, locale = 'pt-BR', frequency = 'weekly', force = false } = opts;
  const runFreq = String(frequency || 'weekly').toLowerCase();

  if (!sendEmail || !isMailConfigured()) {
    console.log('[analytics-scheduled-reports] Email disabled or SMTP not configured.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const companiesRes = await db.query(
    `SELECT id, name
     FROM companies
     WHERE deleted = FALSE
     ORDER BY id
     LIMIT $1`,
    [COMPANIES_CAP]
  );

  const companies = companiesRes.rows;
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const company of companies) {
    try {
      const companyId = company.id;
      const companyName = company.name;

      const prefsRes = await getAnalyticsReportPrefs(db, companyId);
      const prefs = prefsRes.ok ? prefsRes.prefs : { frequency: 'weekly', recipientUserIds: [], attachPdf: false };

      if (prefs.frequency === 'off') {
        skipped += 1;
        continue;
      }
      if (!force && runFreq !== 'all' && prefs.frequency !== runFreq) {
        skipped += 1;
        continue;
      }

      let recipientsRes;
      if (prefs.recipientUserIds?.length) {
        recipientsRes = await db.query(
          `SELECT DISTINCT u.email, u.name
           FROM users u
           WHERE u.company_id = $1
             AND u.active = TRUE
             AND u.deleted = FALSE
             AND u.email IS NOT NULL
             AND u.id = ANY($2::bigint[])`,
          [companyId, prefs.recipientUserIds]
        );
      } else {
        recipientsRes = await db.query(
          `SELECT DISTINCT u.email, u.name
           FROM users u
           WHERE u.company_id = $1
             AND u.active = TRUE
             AND u.deleted = FALSE
             AND u.email IS NOT NULL
             AND u.role IN ('direction', 'admin')`,
          [companyId]
        );
      }

      if (!recipientsRes.rows.length) {
        skipped += 1;
        continue;
      }

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      const [metrics, trends, alerts] = await Promise.all([
        getHiringEffectivenessMetrics(companyId, { startDate, endDate }),
        getAllTrends(companyId, { months: 3 }),
        detectAllAlerts(companyId),
      ]);

      const html = generateReportHTML(companyId, companyName, metrics, trends, alerts, locale);
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      let attachments;
      if (prefs.attachPdf) {
        const pdfLines = [
          `30Grow Analytics — ${companyName}`,
          `Period: ${startDate} → ${endDate}`,
          `Time-to-hire: ${metrics?.timeToHire?.avgDays ?? metrics?.timeToHire ?? '—'}`,
          `Retention 6m: ${
            metrics?.retention?.sixMonths?.rate != null
              ? `${Math.round(Number(metrics.retention.sixMonths.rate) * 100)}%`
              : metrics?.retention?.sixMonths != null && typeof metrics.retention.sixMonths === 'number'
                ? `${Math.round(metrics.retention.sixMonths * 100)}%`
                : '—'
          }`,
          `Hired fit: ${metrics?.fitComparison?.hiredAvgFit ?? '—'}`,
          `Alerts: ${Array.isArray(alerts) ? alerts.length : alerts?.length ?? 0}`,
          '',
          'Open dashboard for full detail.',
        ];
        attachments = [
          {
            filename: `analytics-${companyId}.pdf`,
            content: buildSimplePdf(pdfLines),
            contentType: 'application/pdf',
          },
        ];
      }

      for (const recipient of recipientsRes.rows) {
        try {
          await sendTransactionalMail({
            to: recipient.email,
            subject:
              i18nT(locale, 'ui.analyticsScheduledReports.n30growAnalyticsReport', { companyName }),
            text,
            html,
            attachments,
          });
          sent += 1;
        } catch (mailErr) {
          console.error(`[analytics-scheduled-reports] Failed to send to ${recipient.email}:`, mailErr);
          errors += 1;
        }
      }
    } catch (err) {
      console.error(`[analytics-scheduled-reports] Error processing company ${company.id}:`, err);
      errors += 1;
    }
  }

  console.log(`[analytics-scheduled-reports] Complete. Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`);
  return { sent, skipped, errors };
}
