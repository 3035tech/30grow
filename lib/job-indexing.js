/**
 * Google Indexing API — push URL_UPDATED / URL_DELETED for public job pages.
 *
 * Env:
 * - GOOGLE_INDEXING_ENABLED=true|false (default false)
 * - GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON — JSON inline ou path do arquivo
 * - GOOGLE_INDEXING_MOCK=1 — não chama Google; registra tentativas (DTOV usa mock automático)
 *
 * Nunca deve derrubar create/update/close de vaga — use scheduleVacancyIndexSync (fire-and-forget).
 */

import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { isVacancyTargetDatePast } from './public-vacancy-lifecycle.js';
import { PUBLIC_JOB_PATH_PREFIX, publicVacancyPath } from './public-job-url.js';
import { publicSiteBaseUrl } from './public-site-url.js';

const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const MAX_ATTEMPTS = 3;

/** @type {{ event: string, type?: string, url?: string, vacancyId?: number|null, detail?: string, at: string }[]} */
const mockLog = [];

let cachedToken = null; // { accessToken, expiresAtMs }

export function isGoogleIndexingEnabled() {
  return String(process.env.GOOGLE_INDEXING_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

export function isGoogleIndexingMock() {
  if (String(process.env.GOOGLE_INDEXING_MOCK || '').trim() === '1') return true;
  if (String(process.env.DTOV || '').trim() === '1') return true;
  return false;
}

export function __resetJobIndexingMockLog() {
  mockLog.length = 0;
}

export function __getJobIndexingMockLog() {
  return mockLog.slice();
}

/**
 * Vaga deve aparecer no índice (página pública + allow index + open + prazo ok).
 * @param {{ status?: string, publicPageEnabled?: boolean, publicAllowIndex?: boolean, targetDate?: unknown }} v
 */
export function vacancyShouldBeIndexed(v) {
  if (!v) return false;
  if (String(v.status || '') !== 'open') return false;
  if (!v.publicPageEnabled) return false;
  if (!v.publicAllowIndex) return false;
  if (isVacancyTargetDatePast(v.targetDate)) return false;
  return true;
}

/**
 * @param {{ id?: number, vacancyId?: number, slug?: string, vacancySlug?: string }} v
 */
export function vacancyPublicUrl(v) {
  if (!v) return '';
  const path = publicVacancyPath({
    vacancySlug: v.slug ?? v.vacancySlug,
    vacancyId: v.id ?? v.vacancyId,
  });
  if (!path || path === PUBLIC_JOB_PATH_PREFIX) return '';
  const base = publicSiteBaseUrl();
  return base ? `${base}${path}` : path;
}

function logLine(event, fields = {}) {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...fields,
  };
  if (event.includes('failed') || event === 'job_indexing_failed') {
    console.error(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
  if (isGoogleIndexingMock()) {
    mockLog.push(payload);
  }
}

function loadServiceAccount() {
  const raw = String(process.env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    if (raw.startsWith('{')) return JSON.parse(raw);
    const text = fs.readFileSync(raw, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    logLine('job_indexing_failed', {
      detail: `service_account_parse: ${err?.message || err}`,
    });
    return null;
  }
}

async function getAccessToken(fetchImpl) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) {
    return cachedToken.accessToken;
  }
  const sa = loadServiceAccount();
  if (!sa?.client_email || !sa?.private_key) {
    throw new Error('missing service account client_email/private_key');
  }
  const iat = Math.floor(now / 1000);
  const assertion = jwt.sign(
    {
      iss: sa.client_email,
      scope: INDEXING_SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' }
  );

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`token ${res.status}: ${data.error || data.error_description || 'no token'}`);
  }
  const expiresIn = Number(data.expires_in) || 3600;
  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: now + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} url
 * @param {'URL_UPDATED'|'URL_DELETED'} type
 * @param {{ vacancyId?: number|null, fetchImpl?: typeof fetch }} [opts]
 */
export async function notifyGoogleIndexing(url, type, opts = {}) {
  const pageUrl = String(url || '').trim();
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
    logLine('job_indexing_failed', {
      type,
      url: pageUrl,
      vacancyId: opts.vacancyId ?? null,
      detail: 'invalid_url',
    });
    return { ok: false, skipped: true, reason: 'invalid_url' };
  }

  if (!isGoogleIndexingEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  logLine('job_indexing_requested', {
    type,
    url: pageUrl,
    vacancyId: opts.vacancyId ?? null,
  });

  if (isGoogleIndexingMock()) {
    logLine('job_indexing_success', {
      type,
      url: pageUrl,
      vacancyId: opts.vacancyId ?? null,
      detail: 'mock',
    });
    return { ok: true, mocked: true };
  }

  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    logLine('job_indexing_failed', { type, url: pageUrl, detail: 'no_fetch' });
    return { ok: false, reason: 'no_fetch' };
  }

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const accessToken = await getAccessToken(fetchImpl);
      const res = await fetchImpl(PUBLISH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: pageUrl, type }),
      });
      if (res.ok || res.status === 200) {
        logLine('job_indexing_success', {
          type,
          url: pageUrl,
          vacancyId: opts.vacancyId ?? null,
          detail: `HTTP ${res.status}`,
        });
        return { ok: true };
      }
      const bodyText = await res.text().catch(() => '');
      lastErr = `HTTP ${res.status} ${bodyText.slice(0, 200)}`;
      if (res.status === 401 || res.status === 403) break;
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastErr = err?.message || String(err);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(200 * attempt * attempt);
  }

  logLine('job_indexing_failed', {
    type,
    url: pageUrl,
    vacancyId: opts.vacancyId ?? null,
    detail: lastErr || 'unknown',
  });
  return { ok: false, reason: lastErr };
}

export async function publishJob(url, opts = {}) {
  return notifyGoogleIndexing(url, 'URL_UPDATED', opts);
}

export async function removeJob(url, opts = {}) {
  return notifyGoogleIndexing(url, 'URL_DELETED', opts);
}

/**
 * Sincroniza índice após mutação de vaga (awaitable — preferir scheduleVacancyIndexSync).
 * @param {{ previous?: object|null, current: object, reason?: string }} args
 */
export async function syncVacancyIndex({ previous = null, current, reason = 'sync' }) {
  if (!current) return { ok: true, skipped: true };

  const vacancyId = Number(current.id ?? current.vacancyId) || null;
  const nextUrl = vacancyPublicUrl(current);
  const prevUrl = previous ? vacancyPublicUrl(previous) : '';
  const nowIndexed = vacancyShouldBeIndexed(current);
  const wasIndexed = previous ? vacancyShouldBeIndexed(previous) : false;

  const closedNow =
    previous &&
    String(previous.status || '') !== 'closed' &&
    String(current.status || '') === 'closed';

  if (closedNow) {
    logLine('job_closed', {
      vacancyId,
      url: nextUrl || prevUrl || undefined,
      reason,
    });
  }

  if (!isGoogleIndexingEnabled()) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  try {
    if (nowIndexed) {
      if (wasIndexed && prevUrl && nextUrl && prevUrl !== nextUrl) {
        await removeJob(prevUrl, { vacancyId });
      }
      if (nextUrl) await publishJob(nextUrl, { vacancyId });
      return { ok: true, action: 'publish' };
    }

    if (wasIndexed || closedNow) {
      const urls = new Set([prevUrl, nextUrl].filter(Boolean));
      for (const u of urls) {
        await removeJob(u, { vacancyId });
      }
      return { ok: true, action: 'remove' };
    }

    return { ok: true, skipped: true, reason: 'not_indexable' };
  } catch (err) {
    logLine('job_indexing_failed', {
      vacancyId,
      detail: err?.message || String(err),
      reason,
    });
    return { ok: false };
  }
}

/**
 * Fire-and-forget — não await nas rotas de vaga.
 */
export function scheduleVacancyIndexSync(args) {
  try {
    void syncVacancyIndex(args).catch((err) => {
      logLine('job_indexing_failed', {
        vacancyId: args?.current?.id ?? args?.current?.vacancyId ?? null,
        detail: err?.message || String(err),
        reason: args?.reason || 'schedule',
      });
    });
  } catch (err) {
    logLine('job_indexing_failed', {
      detail: err?.message || String(err),
      reason: 'schedule_throw',
    });
  }
}
