import { contentLocale } from './i18n.js';
/**
 * B-2714 — printable NR-1 support report (browser "Save as PDF").
 * Same esc + print-window idea as client-report-print.js; window kept (no noopener)
 * so print() can be called on the same-origin blob.
 */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {{
 *   locale?: string,
 *   data: { companyName?: string, generatedAt?: string, risks?: object[], summary?: object },
 *   labels: Record<string, string>,
 *   factorLabel: (factor: string) => string,
 *   levelLabel: (level: string) => string,
 *   statusLabel: (status: string) => string,
 *   signalLabel: (signal: string) => string,
 * }} opts
 */
export function buildPsychosocialReportHtml(opts) {
  const { data = {}, labels = {}, factorLabel, levelLabel, statusLabel, signalLabel } = opts;
  const risks = Array.isArray(data.risks) ? data.risks : [];
  const summary = data.summary || {};
  const survey = summary.survey || null;
  const dash = labels.empty || '—';

  let surveyBlock;
  if (!survey) {
    surveyBlock = `<p class="muted">${esc(labels.noSurvey)}</p>`;
  } else if (summary.suppressed) {
    surveyBlock = `<p class="muted">${esc(survey.title)} · ${esc(labels.suppressed)}</p>`;
  } else {
    const rows = (summary.factors || [])
      .map((f) => `<tr><td>${esc(factorLabel(f.factor))}</td><td>${esc(f.favorability)}%</td><td>${esc(signalLabel(f.signal))}</td></tr>`)
      .join('');
    surveyBlock = `<p class="muted">${esc(survey.title)} · ${esc(labels.responses)}</p>
  <table><thead><tr><th>${esc(labels.colFactor)}</th><th>${esc(labels.colFavorability)}</th><th>${esc(labels.colSignal)}</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="3">${esc(dash)}</td></tr>`}</tbody></table>`;
  }

  const riskRows = risks
    .map((r) => `<tr>
      <td>${esc(factorLabel(r.factor))}</td>
      <td>${esc(r.hazard)}${r.exposedGroup ? `<div class="sub">${esc(r.exposedGroup)}</div>` : ''}</td>
      <td>${esc(`${r.probability}×${r.severity} = ${r.riskScore}`)}<div class="sub">${esc(levelLabel(r.level))}</div></td>
      <td class="why">${esc(r.measures || dash)}</td>
      <td>${esc(r.ownerName || dash)}${r.dueDate ? `<div class="sub">${esc(r.dueDate)}</div>` : ''}</td>
      <td>${esc(statusLabel(r.status))}</td>
    </tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="${contentLocale(opts.locale)}">
<head>
  <meta charset="utf-8" />
  <title>${esc(labels.title)}</title>
  <style>
    @page { margin: 16mm; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.45; max-width: 860px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 21px; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 22px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .brand { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #555; margin: 0 0 8px; }
    .meta, .muted { font-family: ui-monospace, monospace; font-size: 11px; color: #666; }
    .disclaimer { font-size: 12px; border: 1px solid #e0c97a; background: #fffaf0; padding: 10px 12px; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #e5e5e5; padding: 7px; text-align: left; vertical-align: top; }
    th { font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; color: #666; background: #fafafa; }
    td.why { font-size: 11px; color: #444; white-space: pre-wrap; }
    .sub { font-size: 10px; color: #777; margin-top: 2px; }
    .footer { margin-top: 28px; font-size: 10px; color: #888; font-family: ui-monospace, monospace; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <p class="brand">${esc(data.companyName || labels.product || '30Grow')}</p>
  <h1>${esc(labels.title)}</h1>
  <p class="meta">${esc(labels.generatedAt)}</p>
  <p class="disclaimer">${esc(labels.disclaimer)}</p>
  <h2>${esc(labels.surveyTitle)}</h2>
  ${surveyBlock}
  <h2>${esc(labels.inventoryTitle)}</h2>
  <table>
    <thead><tr>
      <th>${esc(labels.colFactor)}</th><th>${esc(labels.colHazard)}</th><th>${esc(labels.colRisk)}</th>
      <th>${esc(labels.colMeasures)}</th><th>${esc(labels.colOwner)}</th><th>${esc(labels.colStatus)}</th>
    </tr></thead>
    <tbody>${riskRows || `<tr><td colspan="6">${esc(labels.noRisks)}</td></tr>`}</tbody>
  </table>
  <p class="footer">${esc(labels.footer)}</p>
</body>
</html>`;
}

/** Open synchronously inside the click handler (before any await) so popup blockers allow it. */
export function openPsychosocialReportWindow() {
  if (typeof window === 'undefined') return null;
  return window.open('', '_blank', 'width=900,height=900');
}

/** Loads the report into `win` (from openPsychosocialReportWindow) and triggers print. */
export function printPsychosocialReport(win, opts) {
  if (!win || win.closed) return false;
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([buildPsychosocialReportHtml(opts)], { type: 'text/html;charset=utf-8' }));
  } catch {
    win.close();
    return false;
  }
  let done = false;
  const trigger = () => {
    if (done) return;
    done = true;
    try {
      win.focus();
      win.print();
    } catch {
      /* user can still print from the opened tab */
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  win.addEventListener('load', () => setTimeout(trigger, 50));
  win.location.href = url;
  setTimeout(trigger, 1500);
  return true;
}
