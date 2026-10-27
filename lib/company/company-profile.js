/**
 * Campos de perfil público da empresa (site + sobre + página /c/{slug}).
 */

import { sanitizeInterviewNotesHtml } from '../sanitize-html.js';

const WEBSITE_MAX = 500;
const ABOUT_MAX = 50_000;

/**
 * Valida e normaliza URL http(s). Vazio → null. Inválido → lança INVALID_WEBSITE.
 */
export function normalizeCompanyWebsite(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.length > WEBSITE_MAX) {
    const err = new Error('INVALID_WEBSITE');
    err.code = 'INVALID_WEBSITE';
    throw err;
  }
  let url;
  try {
    url = new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    const err = new Error('INVALID_WEBSITE');
    err.code = 'INVALID_WEBSITE';
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('INVALID_WEBSITE');
    err.code = 'INVALID_WEBSITE';
    throw err;
  }
  return url.toString().replace(/\/$/, '') === `${url.origin}` ? url.origin : url.toString();
}

export function cleanCompanyAboutHtml(raw) {
  if (raw == null || raw === '') return null;
  const html = sanitizeInterviewNotesHtml(raw, ABOUT_MAX);
  return html || null;
}

/**
 * YYYY-MM-DD ou vazio → null. Inválido → lança INVALID_DATE.
 */
export function normalizeCompanyAnniversaryDate(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error('INVALID_DATE');
    err.code = 'INVALID_DATE';
    throw err;
  }
  return s;
}

/**
 * Extrai website / aboutHtml / publicProfileEnabled / anniversaryDate do body.
 * Omitidos → undefined (PATCH não atualiza). forCreate: omitidos → null / false.
 */
export function parseCompanyProfileFromBody(body = {}, { forCreate = false } = {}) {
  const hasWebsite = body.website !== undefined;
  const hasAbout =
    body.aboutHtml !== undefined || body.about_html !== undefined || body.about !== undefined;
  const hasPublicProfile =
    body.publicProfileEnabled !== undefined || body.public_profile_enabled !== undefined;
  const hasAnniversary =
    body.anniversaryDate !== undefined || body.anniversary_date !== undefined;

  let website;
  if (forCreate) {
    website = hasWebsite ? normalizeCompanyWebsite(body.website) : null;
  } else if (hasWebsite) {
    website = normalizeCompanyWebsite(body.website);
  } else {
    website = undefined;
  }

  let aboutHtml;
  if (forCreate) {
    aboutHtml = hasAbout
      ? cleanCompanyAboutHtml(body.aboutHtml ?? body.about_html ?? body.about)
      : null;
  } else if (hasAbout) {
    aboutHtml = cleanCompanyAboutHtml(body.aboutHtml ?? body.about_html ?? body.about);
  } else {
    aboutHtml = undefined;
  }

  let publicProfileEnabled;
  if (forCreate) {
    publicProfileEnabled = hasPublicProfile
      ? Boolean(body.publicProfileEnabled ?? body.public_profile_enabled)
      : false;
  } else if (hasPublicProfile) {
    publicProfileEnabled = Boolean(body.publicProfileEnabled ?? body.public_profile_enabled);
  } else {
    publicProfileEnabled = undefined;
  }

  let anniversaryDate;
  if (forCreate) {
    anniversaryDate = hasAnniversary
      ? normalizeCompanyAnniversaryDate(body.anniversaryDate ?? body.anniversary_date)
      : null;
  } else if (hasAnniversary) {
    anniversaryDate = normalizeCompanyAnniversaryDate(body.anniversaryDate ?? body.anniversary_date);
  } else {
    anniversaryDate = undefined;
  }

  return { website, aboutHtml, publicProfileEnabled, anniversaryDate };
}

export const COMPANY_PROFILE_SQL_SELECT = `
  c.website,
  c.about_html AS "aboutHtml",
  c.public_profile_enabled AS "publicProfileEnabled",
  c.logo_url AS "logoUrl",
  c.logo_key AS "logoKey"`.trim();
