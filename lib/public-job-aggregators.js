/**
 * Agregadores SEO públicos: /jobs/remote e /jobs/city/{slug}.
 * Só publicam (HTML indexável + sitemap) quando count ≥ limiar (env).
 */

import { queryRead } from './db.js';
import { slugify } from './slugify.js';
import { normalizeWorkplaceCity } from './vacancy-workplace.js';
import { ERR } from './api-error-codes.js';
import { VACANCY_STATUS } from './domain-status.js';
import {
  publicCityAggregatorPath,
  publicRemoteAggregatorPath,
} from './public-job-url.js';
import { listOpenPublicVacancies } from './public-vacancy-posting.js';
import { publicSiteBaseUrl } from './public-site-url.js';

const DEFAULT_MIN_COUNT = 3;
const SITEMAP_CITY_CAP = 200;

/** Limiar mínimo de vagas indexáveis para publicar o agregador (default 3). */
export function aggregatorMinCount() {
  const n = parseInt(String(process.env.PUBLIC_JOB_AGGREGATOR_MIN_COUNT || ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MIN_COUNT;
  return Math.min(100, Math.floor(n));
}

/** Slug de cidade a partir do nome livre (IBGE / texto). */
export function citySlugFromName(city) {
  const name = normalizeWorkplaceCity(city);
  if (!name) return '';
  return slugify(name, { maxLength: 64 });
}

const PUBLIC_OPEN_WHERE = `
  v.deleted = FALSE
  AND c.deleted = FALSE
  AND c.active = TRUE
  AND v.public_page_enabled = TRUE
  AND v.public_allow_index = TRUE
  AND v.status = '${VACANCY_STATUS.OPEN}'
  AND (v.target_date IS NULL OR v.target_date >= CURRENT_DATE)
`;

/**
 * Contagens por cidade (texto btrim) entre vagas públicas indexáveis.
 * @param {{ minCount?: number, limit?: number }} [opts]
 * @returns {Promise<Array<{ city: string, count: number, slug: string, path: string }>>}
 */
export async function listPublicCityCounts(opts = {}) {
  const minRaw = Number(opts.minCount);
  const minCount =
    Number.isFinite(minRaw) && minRaw >= 1 ? Math.min(100, Math.floor(minRaw)) : 1;
  const limRaw = Number(opts.limit);
  const limit = Number.isFinite(limRaw)
    ? Math.min(SITEMAP_CITY_CAP, Math.max(1, Math.floor(limRaw)))
    : SITEMAP_CITY_CAP;

  const r = await queryRead(
    `SELECT btrim(v.workplace_city) AS city, COUNT(*)::int AS n
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE ${PUBLIC_OPEN_WHERE}
       AND v.workplace_city IS NOT NULL
       AND btrim(v.workplace_city) <> ''
     GROUP BY btrim(v.workplace_city)
     HAVING COUNT(*) >= $1
     ORDER BY n DESC, city ASC
     LIMIT $2`,
    [minCount, limit]
  );

  const out = [];
  for (const row of r.rows || []) {
    const city = normalizeWorkplaceCity(row.city);
    const slug = citySlugFromName(city);
    if (!city || !slug) continue;
    out.push({
      city,
      count: Number(row.n) || 0,
      slug,
      path: publicCityAggregatorPath(slug),
    });
  }
  return out;
}

/**
 * @returns {Promise<{ ok: true, total: number, path: string } | { ok: false, errorCode: string }>}
 */
export async function resolveRemoteAggregator() {
  const listed = await listOpenPublicVacancies({
    workplaceModality: 'remote',
    page: 1,
    pageSize: 1,
    includeTotal: true,
  });
  const total = Number(listed.total) || 0;
  if (total < aggregatorMinCount()) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }
  return { ok: true, total, path: publicRemoteAggregatorPath() };
}

/**
 * Resolve agregador de cidade pelo slug. Soma variantes que colidem no mesmo slug.
 * @returns {Promise<{ ok: true, city: string, cityNames: string[], slug: string, total: number, path: string } | { ok: false, errorCode: string }>}
 */
export async function resolveCityAggregator(citySlug) {
  const slug = slugify(String(citySlug || ''), { maxLength: 64 });
  if (!slug) return { ok: false, errorCode: ERR.NOT_FOUND };

  const cities = await listPublicCityCounts({ minCount: 1, limit: SITEMAP_CITY_CAP });
  const matches = cities.filter((c) => c.slug === slug);
  if (!matches.length) return { ok: false, errorCode: ERR.NOT_FOUND };

  const total = matches.reduce((sum, c) => sum + (Number(c.count) || 0), 0);
  if (total < aggregatorMinCount()) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }

  matches.sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  return {
    ok: true,
    city: matches[0].city,
    cityNames: matches.map((m) => m.city),
    slug,
    total,
    path: publicCityAggregatorPath(slug),
  };
}

/**
 * Entradas de sitemap para agregadores que passam o limiar (remoto + cidades, cap).
 * @param {{ limit?: number }} [opts]
 */
export async function listSitemapAggregatorEntries(opts = {}) {
  const limRaw = Number(opts.limit);
  const cityLimit = Number.isFinite(limRaw)
    ? Math.min(SITEMAP_CITY_CAP, Math.max(0, Math.floor(limRaw)))
    : SITEMAP_CITY_CAP;
  const min = aggregatorMinCount();
  const base = publicSiteBaseUrl();
  const now = new Date();
  const entries = [];

  try {
    const remote = await resolveRemoteAggregator();
    if (remote.ok) {
      const path = remote.path || publicRemoteAggregatorPath();
      entries.push({
        path,
        url: base ? `${base}${path}` : path,
        lastModified: now,
        kind: 'remote',
      });
    }
  } catch (err) {
    console.error('[aggregators] remote sitemap check failed', err?.message || err);
  }

  if (cityLimit <= 0) return entries;

  try {
    const cities = await listPublicCityCounts({ minCount: min, limit: cityLimit });
    const seen = new Set();
    for (const c of cities) {
      if (!c.slug || seen.has(c.slug)) continue;
      seen.add(c.slug);
      const path = c.path || publicCityAggregatorPath(c.slug);
      entries.push({
        path,
        url: base ? `${base}${path}` : path,
        lastModified: now,
        kind: 'city',
        city: c.city,
      });
    }
  } catch (err) {
    console.error('[aggregators] city sitemap list failed', err?.message || err);
  }

  return entries;
}

/**
 * Lista paginada para a página do agregador (reusa listOpenPublicVacancies).
 */
export async function listAggregatorVacancies(kind, opts = {}) {
  const page = opts.page;
  const pageSize = opts.pageSize ?? 12;
  if (kind === 'remote') {
    return listOpenPublicVacancies({
      workplaceModality: 'remote',
      page,
      pageSize,
      includeTotal: true,
    });
  }
  if (kind === 'city') {
    const cities = Array.isArray(opts.cityNames) ? opts.cityNames : [];
    const single = normalizeWorkplaceCity(opts.city);
    return listOpenPublicVacancies({
      workplaceCities: cities.length ? cities : single ? [single] : [],
      page,
      pageSize,
      includeTotal: true,
    });
  }
  return { items: [], total: 0, page: 1, pageSize };
}
