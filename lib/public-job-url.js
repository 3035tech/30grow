import { publicSiteBaseUrl } from './public-site-url.js';

/**
 * Canonical public paths — no DB (safe for client components).
 * English paths aligned with assessment tokens `/t` `/v` `/r`.
 */

/** Canonical public job listing + detail prefix. */
export const PUBLIC_JOB_PATH_PREFIX = '/jobs';

/** Canonical public company careers prefix. */
export const PUBLIC_COMPANY_PATH_PREFIX = '/companies';

/** SEO aggregator: remote jobs (`workplace_modality = remote`). */
export const PUBLIC_REMOTE_AGGREGATOR_PATH = `${PUBLIC_JOB_PATH_PREFIX}/remote`;

/** City aggregator prefix: `/jobs/city/{slug}`. */
export const PUBLIC_CITY_AGGREGATOR_PREFIX = `${PUBLIC_JOB_PATH_PREFIX}/city`;

/**
 * Canonical path: `/jobs/{slug}-{id}` (id = vacancies.id).
 * Accepts `{ vacancySlug|slug, vacancyId|id }` or legacy args
 * `(companySlug, vacancySlug, vacancyId)` — companySlug ignored in the URL.
 */
export function publicVacancyPath(a, b, c) {
  let vacancySlug = '';
  let vacancyId = null;
  if (a != null && typeof a === 'object' && !Array.isArray(a)) {
    vacancySlug = String(a.vacancySlug ?? a.slug ?? '').trim();
    vacancyId = Number(a.vacancyId ?? a.id);
  } else if (c != null || (b != null && /^\d+$/.test(String(b)))) {
    if (c != null) {
      vacancySlug = String(b || '').trim();
      vacancyId = Number(c);
    } else {
      vacancySlug = String(a || '').trim();
      vacancyId = Number(b);
    }
  } else {
    vacancySlug = String(b || a || '').trim();
    vacancyId = NaN;
  }
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) return PUBLIC_JOB_PATH_PREFIX;
  const slugPart = vacancySlug || 'role';
  return `${PUBLIC_JOB_PATH_PREFIX}/${encodeURIComponent(slugPart)}-${vacancyId}`;
}

export function publicVacancyAbsoluteUrl(a, b, c) {
  const base = publicSiteBaseUrl();
  const path = publicVacancyPath(a, b, c);
  return base ? `${base}${path}` : path;
}

/** Canonical path: `/companies/{companySlug}`. */
export function publicCompanyPath(companySlug) {
  const slug = String(companySlug || '').trim();
  if (!slug) return PUBLIC_COMPANY_PATH_PREFIX;
  return `${PUBLIC_COMPANY_PATH_PREFIX}/${encodeURIComponent(slug)}`;
}

export function publicCompanyAbsoluteUrl(companySlug) {
  const base = publicSiteBaseUrl();
  const path = publicCompanyPath(companySlug);
  return base ? `${base}${path}` : path;
}

/** Canonical path: `/jobs/remote`. */
export function publicRemoteAggregatorPath() {
  return PUBLIC_REMOTE_AGGREGATOR_PATH;
}

/**
 * Canonical path: `/jobs/city/{citySlug}`.
 * @param {string} citySlug
 */
export function publicCityAggregatorPath(citySlug) {
  const slug = String(citySlug || '').trim();
  if (!slug) return PUBLIC_CITY_AGGREGATOR_PREFIX;
  return `${PUBLIC_CITY_AGGREGATOR_PREFIX}/${encodeURIComponent(slug)}`;
}

/**
 * Parse `/jobs/{slug}-{id}` segment (or `{id}` alone).
 * @returns {{ slug: string, id: number } | null}
 */
export function parsePublicJobKey(jobKey) {
  const raw = decodeURIComponent(String(jobKey || '').trim());
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { slug: '', id };
  }
  const m = raw.match(/^(.*)-(\d+)$/);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { slug: String(m[1] || '').trim(), id };
}
