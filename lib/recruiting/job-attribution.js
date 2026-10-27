/**
 * Atribuição de origem (UTM + ref) — cookie first-party, sem PII.
 * Compatível com Edge (middleware) e Node (API routes).
 */

export const JOB_ATTR_COOKIE = 'team30_job_attr';
export const JOB_ATTR_MAX_AGE_SEC = 7 * 24 * 60 * 60;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function clip(v, max) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

function newSessionId() {
  try {
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * @param {URLSearchParams|Record<string,string>} params
 * @param {string} [landingPath]
 * @param {{ sessionId?: string|null }} [opts]
 */
export function parseAttributionFromSearchParams(params, landingPath = '', opts = {}) {
  const get = (k) => {
    if (typeof params?.get === 'function') return params.get(k);
    return params?.[k];
  };
  const source = clip(get('utm_source'), 80);
  const medium = clip(get('utm_medium'), 80);
  const campaign = clip(get('utm_campaign'), 120);
  const content = clip(get('utm_content'), 120);
  const term = clip(get('utm_term'), 120);
  const ref = clip(get('ref'), 64);
  const hasAny = Boolean(source || medium || campaign || content || term || ref);
  if (!hasAny && !opts.force) return null;

  let landing = clip(landingPath, 200);
  if (landing && !landing.startsWith('/')) landing = `/${landing}`;

  return {
    sessionId: clip(opts.sessionId, 64) || newSessionId(),
    source,
    medium,
    campaign,
    content,
    term,
    ref,
    landing: landing || null,
    capturedAt: new Date().toISOString(),
  };
}

/** True se a URL traz parâmetros de atribuição. */
export function searchHasAttribution(params) {
  const get = (k) => (typeof params?.get === 'function' ? params.get(k) : params?.[k]);
  if (get('ref')) return true;
  return UTM_KEYS.some((k) => Boolean(get(k)));
}

/**
 * Mescla cookie existente com novos UTM (primeira captura de campo vence, session preservada).
 */
export function mergeAttribution(existing, incoming) {
  if (!incoming) return existing || null;
  if (!existing) return incoming;
  return {
    sessionId: existing.sessionId || incoming.sessionId || newSessionId(),
    source: existing.source || incoming.source,
    medium: existing.medium || incoming.medium,
    campaign: existing.campaign || incoming.campaign,
    content: existing.content || incoming.content,
    term: existing.term || incoming.term,
    ref: existing.ref || incoming.ref,
    landing: existing.landing || incoming.landing,
    capturedAt: existing.capturedAt || incoming.capturedAt,
  };
}

function toBase64Url(str) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(raw) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'base64url').toString('utf8');
  }
  const b64 = String(raw).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeAttributionCookie(attr) {
  if (!attr) return '';
  try {
    return toBase64Url(JSON.stringify(attr));
  } catch {
    return '';
  }
}

export function decodeAttributionCookie(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const json = fromBase64Url(s);
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object') return null;
    return {
      sessionId: clip(obj.sessionId, 64) || newSessionId(),
      source: clip(obj.source, 80),
      medium: clip(obj.medium, 80),
      campaign: clip(obj.campaign, 120),
      content: clip(obj.content, 120),
      term: clip(obj.term, 120),
      ref: clip(obj.ref, 64),
      landing: clip(obj.landing, 200),
      capturedAt: clip(obj.capturedAt, 40),
    };
  } catch {
    return null;
  }
}

/**
 * Mapeia UTM/ref → enum grosso de candidates.source.
 * @returns {'linkedin'|'referral'|'agency'|'job_board'|'other'|null}
 */
export function mapAttributionToCandidateSource(attr) {
  if (!attr) return null;
  if (attr.ref) return 'referral';
  const s = String(attr.source || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s.includes('linkedin')) return 'linkedin';
  if (s.includes('agency') || s.includes('agencia')) return 'agency';
  if (
    ['google', 'bing', 'indeed', 'catho', 'infojobs', 'gupy', 'vagas.com', 'job'].some((x) =>
      s.includes(x)
    )
  ) {
    return 'job_board';
  }
  return 'other';
}

export function attributionCookieOptions() {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    String(process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://');
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: JOB_ATTR_MAX_AGE_SEC,
    secure,
  };
}

/** Campos SQL para INSERT em assessments. */
export function attributionToAssessmentCols(attr) {
  if (!attr) {
    return {
      attrSource: null,
      attrMedium: null,
      attrCampaign: null,
      attrContent: null,
      attrTerm: null,
      attrRef: null,
      attrLanding: null,
      attrSessionId: null,
    };
  }
  return {
    attrSource: attr.source,
    attrMedium: attr.medium,
    attrCampaign: attr.campaign,
    attrContent: attr.content,
    attrTerm: attr.term,
    attrRef: attr.ref,
    attrLanding: attr.landing,
    attrSessionId: attr.sessionId,
  };
}
