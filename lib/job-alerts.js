import { runtimeAppUrl } from './app-url.js';
/**
 * Cadastro público de alertas de vaga (e-mail) + unsubscribe + disparo no publish.
 * Path de cancelamento (neutro): `/a/unsubscribe?token=…`
 *
 * Disparo: só em transição para “página pública aberta” (create ou off→on).
 * SMTP ausente → no-op (não falha o save da vaga).
 */

import crypto from 'crypto';
import { query, queryRead } from './db.js';
import { isMailConfigured, sendTransactionalMail } from './mail.js';
import { isVacancyTargetDatePast } from './public-vacancy-lifecycle.js';
import { PUBLIC_JOB_PATH_PREFIX, publicVacancyPath } from './public-job-url.js';
import { ERR } from './api-error-codes.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALERT_BATCH_LIMIT = 200;

export function jobAlertUnsubscribePath(token) {
  const tok = String(token || '').trim();
  if (!tok) return '/a/unsubscribe';
  return `/a/unsubscribe?token=${encodeURIComponent(tok)}`;
}

export function normalizeAlertEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/**
 * Upsert alerta ativo. Idempotente por e-mail.
 * @returns {{ ok: true, created: boolean } | { ok: false, errorCode: string }}
 */
export async function upsertJobAlert({ email, name = null, filters = {} }) {
  const em = normalizeAlertEmail(email);
  if (!em || !EMAIL_RE.test(em)) return { ok: false, errorCode: ERR.VALID_EMAIL_REQUIRED };
  const nm = String(name || '').trim().slice(0, 120) || null;
  const filt = filters && typeof filters === 'object' ? filters : {};
  const token = crypto.randomBytes(24).toString('hex');

  const existing = await queryRead(
    `SELECT id, active FROM job_alerts WHERE LOWER(email) = $1 LIMIT 1`,
    [em]
  );

  if (existing.rowCount > 0) {
    await query(
      `UPDATE job_alerts
       SET active = TRUE,
           name = COALESCE($2, name),
           filters = $3::jsonb,
           unsubscribed_at = NULL,
           unsubscribe_token = CASE WHEN active = FALSE THEN $4 ELSE unsubscribe_token END
       WHERE id = $1`,
      [existing.rows[0].id, nm, JSON.stringify(filt), token]
    );
    return { ok: true, created: false };
  }

  await query(
    `INSERT INTO job_alerts (email, name, filters, unsubscribe_token)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [em, nm, JSON.stringify(filt), token]
  );
  return { ok: true, created: true };
}

export async function unsubscribeJobAlert(token) {
  const tok = String(token || '').trim();
  if (!tok || tok.length < 16) return { ok: false, errorCode: ERR.INVALID_TOKEN };
  const r = await query(
    `UPDATE job_alerts
     SET active = FALSE, unsubscribed_at = NOW()
     WHERE unsubscribe_token = $1 AND active = TRUE
     RETURNING id`,
    [tok]
  );
  return { ok: true, updated: r.rowCount > 0 };
}

/**
 * Vaga elegível a alerta: aberta, página pública ligada, prazo ok.
 * (Não exige index — quem assinou quer saber de oportunidades públicas.)
 */
export function vacancyIsAlertablePublic(v) {
  if (!v) return false;
  if (String(v.status || '') !== 'open') return false;
  if (!v.publicPageEnabled) return false;
  if (isVacancyTargetDatePast(v.targetDate)) return false;
  return true;
}

/**
 * Só dispara na transição para alertável (create ou off→on).
 * Evita e-mail a cada PATCH cosmético.
 */
export function shouldDispatchJobAlerts({ previous = null, current } = {}) {
  if (!vacancyIsAlertablePublic(current)) return false;
  if (!previous) return true;
  return !vacancyIsAlertablePublic(previous);
}

/**
 * Filtros do cadastro: q (título), employmentType, workplaceModality.
 */
export function jobAlertMatchesVacancy(filters, vacancy) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const emp = String(f.employmentType || f.employment_type || '')
    .trim()
    .toLowerCase();
  if (emp) {
    const vacEmp = String(vacancy?.employmentType || vacancy?.employment_type || '')
      .trim()
      .toLowerCase();
    if (!vacEmp || vacEmp !== emp) return false;
  }
  const modality = String(f.workplaceModality || f.workplace_modality || '')
    .trim()
    .toLowerCase();
  if (modality) {
    const vacMod = String(vacancy?.workplaceModality || vacancy?.workplace_modality || '')
      .trim()
      .toLowerCase();
    if (!vacMod || vacMod !== modality) return false;
  }
  const q = String(f.q || f.query || '')
    .trim()
    .toLowerCase();
  if (q) {
    const title = String(vacancy?.title || '')
      .trim()
      .toLowerCase();
    if (!title.includes(q)) return false;
  }
  return true;
}

function vacancyAbsoluteUrl(v) {
  const path = publicVacancyPath({
    vacancySlug: v?.slug ?? v?.vacancySlug,
    vacancyId: v?.id ?? v?.vacancyId,
  });
  if (!path || path === PUBLIC_JOB_PATH_PREFIX) return '';
  const base = String(runtimeAppUrl() || '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

function buildAlertMail({ name, title, companyName, pageUrl, unsubUrl }) {
  const who = name ? `Olá, ${name}` : 'Olá';
  const company = companyName ? ` (${companyName})` : '';
  const subject = `Nova vaga: ${title}`;
  const text = [
    `${who},`,
    '',
    `Uma nova vaga foi publicada${company}:`,
    title,
    '',
    pageUrl ? `Ver detalhes: ${pageUrl}` : '',
    '',
    'Você recebeu este e-mail porque se inscreveu em avisos de vagas no 30Grow.',
    unsubUrl ? `Cancelar avisos: ${unsubUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const html = text.replace(/\n/g, '<br/>');
  return { subject, text, html };
}

/**
 * @param {{ previous?: object|null, current: object, companyName?: string|null }} args
 */
export async function dispatchJobAlertsForVacancy(args) {
  const { previous = null, current, companyName = null } = args || {};
  if (!shouldDispatchJobAlerts({ previous, current })) {
    return { ok: true, skipped: true, reason: 'no_transition' };
  }
  if (!isMailConfigured()) {
    console.info('[job-alerts] skip dispatch: SMTP not configured', {
      vacancyId: current?.id ?? null,
    });
    return { ok: true, skipped: true, reason: 'smtp_off' };
  }

  const pageUrl = vacancyAbsoluteUrl(current);
  if (!pageUrl) {
    return { ok: true, skipped: true, reason: 'no_url' };
  }

  const r = await queryRead(
    `SELECT id, email, name, filters, unsubscribe_token AS "unsubscribeToken"
     FROM job_alerts
     WHERE active = TRUE
     ORDER BY created_at ASC
     LIMIT $1`,
    [ALERT_BATCH_LIMIT]
  );

  const rows = r.rows || [];
  let sent = 0;
  let matched = 0;
  for (const row of rows) {
    let filters = row.filters;
    if (typeof filters === 'string') {
      try {
        filters = JSON.parse(filters);
      } catch {
        filters = {};
      }
    }
    if (!jobAlertMatchesVacancy(filters, current)) continue;
    matched += 1;
    const base = String(runtimeAppUrl() || '').replace(/\/$/, '');
    const unsubPath = jobAlertUnsubscribePath(row.unsubscribeToken);
    const unsubUrl = base ? `${base}${unsubPath}` : unsubPath;
    const mail = buildAlertMail({
      name: row.name,
      title: current.title || 'Vaga',
      companyName,
      pageUrl,
      unsubUrl,
    });
    try {
      await sendTransactionalMail({ to: row.email, ...mail });
      sent += 1;
    } catch (e) {
      console.error('[job-alerts] send failed', {
        alertId: row.id,
        code: e?.code,
        message: e?.message,
      });
    }
  }

  console.info('[job-alerts] dispatch done', {
    vacancyId: current?.id ?? null,
    candidates: rows.length,
    matched,
    sent,
  });
  return { ok: true, matched, sent };
}

/**
 * Fire-and-forget — não await nas rotas de vaga.
 */
export function scheduleJobAlertDispatch(args) {
  try {
    void dispatchJobAlertsForVacancy(args).catch((err) => {
      console.error('[job-alerts] schedule failed', {
        vacancyId: args?.current?.id ?? null,
        message: err?.message || String(err),
      });
    });
  } catch (err) {
    console.error('[job-alerts] schedule throw', err?.message || String(err));
  }
}
