import { runtimeAppUrl } from './app-url.js';
/**
 * Public vacancy page — canonical `/jobs/{slug}-{id}` + JobPosting SEO.
 */

import { queryRead } from './db.js';
import { htmlToPlainText } from './sanitize-html.js';
import { t as i18nT, contentLocale } from './i18n.js';
import { salaryAmountNumber } from './br-masks.js';
import { normalizeEmploymentType } from './vacancy-employment-type.js';
import { ERR } from './api-error-codes.js';
import { VACANCY_STATUS } from './domain-status.js';
import {
  normalizeWorkplaceCity,
  normalizeWorkplaceModality,
  normalizeWorkplaceState,
} from './vacancy-workplace.js';
import { BRAND_ASSETS } from './brand.js';
import {
  isVacancyTargetDatePast,
  postingDocumentTitle,
  publicVacancyShowsClosedExperience,
} from './public-vacancy-lifecycle.js';
import {
  PUBLIC_JOB_PATH_PREFIX,
  publicVacancyPath,
  publicVacancyAbsoluteUrl,
} from './public-job-url.js';
import { publicSiteBaseUrl } from './public-site-url.js';

export {
  toVacancyDateYmd,
  isVacancyTargetDatePast,
  publicVacancyShowsClosedExperience,
  publicVacancyCanApply,
  postingDocumentTitle,
  formatPublicVacancyDate,
  publicVacancyClosedReason,
} from './public-vacancy-lifecycle.js';

export {
  PUBLIC_JOB_PATH_PREFIX,
  publicVacancyPath,
  publicVacancyAbsoluteUrl,
  parsePublicJobKey,
} from './public-job-url.js';

function appBaseUrl() {
  return String(runtimeAppUrl() || '').replace(/\/$/, '');
}

/** Absolute OG/Twitter image — brand mark until company/vacancy images exist. */
export function defaultPublicOgImageUrl() {
  const base = publicSiteBaseUrl();
  const path = BRAND_ASSETS.s512;
  return base ? `${base}${path}` : path;
}

/** Schema.org / Google for Jobs employmentType */
export function schemaEmploymentType(employmentType) {
  const v = normalizeEmploymentType(employmentType);
  if (v === 'internship') return 'INTERN';
  if (v === 'pj') return 'CONTRACTOR';
  if (v === 'cooperative') return 'OTHER';
  if (v === 'clt') return 'FULL_TIME';
  return null;
}

function clipPlain(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

const PUBLIC_POSTING_SELECT = `
       v.id AS "vacancyId",
       v.title,
       v.slug AS "vacancySlug",
       v.status,
       v.description,
       v.salary_min AS "salaryMin",
       v.salary_max AS "salaryMax",
       v.employment_type AS "employmentType",
       v.workplace_modality AS "workplaceModality",
       v.workplace_city AS "workplaceCity",
       v.workplace_state AS "workplaceState",
       v.target_date AS "targetDate",
       v.created_at AS "createdAt",
       v.public_page_enabled AS "publicPageEnabled",
       v.public_allow_index AS "publicAllowIndex",
       v.public_show_company_info AS "publicShowCompanyInfo",
       v.public_show_salary AS "publicShowSalary",
       c.id AS "companyId",
       c.name AS "companyName",
       c.slug AS "companySlug",
       c.website AS "companyWebsite",
       c.about_html AS "companyAboutHtml",
       c.logo_url AS "companyLogoUrl",
       c.public_profile_enabled AS "companyPublicProfileEnabled",
       vl.token AS "applyToken",
       vl.expires_at AS "applyTokenExpiresAt"
`;

const PUBLIC_POSTING_FROM = `
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     LEFT JOIN LATERAL (
       SELECT token, expires_at
       FROM vacancy_links
       WHERE vacancy_id = v.id AND active = TRUE AND expires_at > NOW()
       ORDER BY expires_at DESC NULLS LAST
       LIMIT 1
     ) vl ON TRUE
`;

function rowToPosting(row, now = new Date()) {
  const showCompany = Boolean(row.publicShowCompanyInfo);
  const showSalary = Boolean(row.publicShowSalary);
  const statusOpen = String(row.status) === 'open';
  const expired = isVacancyTargetDatePast(row.targetDate, now);
  const openForPublic = statusOpen && !expired;
  const allowIndex = Boolean(row.publicAllowIndex) && openForPublic;
  const applyPath = row.applyToken ? `/v/${row.applyToken}` : null;
  const applyUrl = applyPath && appBaseUrl() ? `${appBaseUrl()}${applyPath}` : applyPath;
  const pageUrl = publicVacancyAbsoluteUrl({
    vacancySlug: row.vacancySlug,
    vacancyId: row.vacancyId,
  });

  return {
    vacancyId: row.vacancyId,
    title: row.title,
    vacancySlug: row.vacancySlug,
    status: row.status,
    description: row.description || '',
    employmentType: row.employmentType || null,
    workplaceModality: row.workplaceModality || null,
    workplaceCity: row.workplaceCity || null,
    workplaceState: row.workplaceState || null,
    targetDate: row.targetDate || null,
    createdAt: row.createdAt,
    publicAllowIndex: allowIndex,
    openForPublic,
    closedReason: !statusOpen ? 'closed' : expired ? 'expired' : null,
    showCompany,
    showSalary,
    companyPublicProfileEnabled: Boolean(row.companyPublicProfileEnabled),
    salaryMin: showSalary ? row.salaryMin : null,
    salaryMax: showSalary ? row.salaryMax : null,
    company: showCompany
      ? {
          id: row.companyId,
          name: row.companyName,
          slug: row.companySlug,
          website: row.companyWebsite || null,
          aboutHtml: row.companyAboutHtml || '',
          logoUrl: row.companyLogoUrl || null,
          publicProfileEnabled: Boolean(row.companyPublicProfileEnabled),
        }
      : {
          id: null,
          name: null,
          slug: null,
          website: null,
          aboutHtml: '',
          logoUrl: null,
          publicProfileEnabled: false,
        },
    companySlug: showCompany ? row.companySlug : null,
    companyId: showCompany ? row.companyId : null,
    pageUrl,
    applyUrl,
    applyPath,
  };
}

/**
 * Resolve por id (URL canônica). Se `expectedSlug` ≠ slug no DB → `canonicalPath` para redirect.
 * @returns {Promise<
 *   | { ok: true, posting: object, canonicalPath: string, slugMismatch: boolean }
 *   | { ok: false, errorCode: string, status?: number }
 * >}
 */
export async function resolvePublicVacancyPostingById(vacancyId, expectedSlug = '') {
  const id = Number(vacancyId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const r = await queryRead(
    `SELECT ${PUBLIC_POSTING_SELECT}
     ${PUBLIC_POSTING_FROM}
     WHERE v.id = $1
       AND v.deleted = FALSE
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND v.public_page_enabled = TRUE
     LIMIT 1`,
    [id]
  );

  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const posting = rowToPosting(r.rows[0]);
  const canonicalPath = publicVacancyPath({
    vacancySlug: posting.vacancySlug,
    vacancyId: posting.vacancyId,
  });
  const want = String(expectedSlug || '').trim().toLowerCase();
  const got = String(posting.vacancySlug || '').trim().toLowerCase();
  const slugMismatch = Boolean(want) && want !== got;

  return { ok: true, posting, canonicalPath, slugMismatch };
}

/**
 * Resolve legado por company slug + vacancy slug (redirect → canônica).
 * @returns {Promise<
 *   | { ok: true, posting: object, canonicalPath: string }
 *   | { ok: false, errorCode: string, status?: number }
 * >}
 */
export async function resolvePublicVacancyPosting(companySlug, vacancySlug) {
  const cSlug = String(companySlug || '').trim();
  const vSlug = String(vacancySlug || '').trim();
  if (!cSlug || !vSlug) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const r = await queryRead(
    `SELECT ${PUBLIC_POSTING_SELECT}
     ${PUBLIC_POSTING_FROM}
     WHERE LOWER(c.slug) = LOWER($1)
       AND LOWER(v.slug) = LOWER($2)
       AND v.deleted = FALSE
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND v.public_page_enabled = TRUE
     LIMIT 1`,
    [cSlug, vSlug]
  );

  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const posting = rowToPosting(r.rows[0]);
  const canonicalPath = publicVacancyPath({
    vacancySlug: posting.vacancySlug,
    vacancyId: posting.vacancyId,
  });
  return { ok: true, posting, canonicalPath };
}

const PUBLIC_LIST_CAP = 48;
const PUBLIC_INDEX_PAGE_SIZE_DEFAULT = 12;
const PUBLIC_INDEX_PAGE_SIZE_MAX = 48;

/**
 * Vagas abertas com página pública (índice /j, relacionadas, empresa).
 * Sem `page` / `includeTotal`: retorna array (legado — relacionadas).
 * Com `page` ou `includeTotal: true`: `{ items, total, page, pageSize }`.
 *
 * @param {{
 *   companyId?: number|null,
 *   excludeVacancyId?: number|null,
 *   limit?: number,
 *   q?: string|null,
 *   employmentType?: string|null,
 *   workplaceModality?: string|null,
 *   workplaceCity?: string|null,
 *   workplaceCities?: string[]|null,
 *   page?: number|null,
 *   pageSize?: number|null,
 *   includeTotal?: boolean,
 * }} [opts]
 */
export async function listOpenPublicVacancies(opts = {}) {
  const wantPaged = opts.includeTotal === true || opts.page != null;
  const pageSizeRaw = Number(opts.pageSize ?? opts.limit);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(PUBLIC_INDEX_PAGE_SIZE_MAX, Math.max(1, Math.floor(pageSizeRaw)))
    : wantPaged
      ? PUBLIC_INDEX_PAGE_SIZE_DEFAULT
      : Math.min(PUBLIC_LIST_CAP, Math.max(1, Number(opts.limit) || 12));
  const pageRaw = Number(opts.page);
  const page = wantPaged
    ? Number.isFinite(pageRaw) && pageRaw >= 1
      ? Math.floor(pageRaw)
      : 1
    : 1;
  const offset = (page - 1) * pageSize;

  const companyId =
    opts.companyId != null && Number.isFinite(Number(opts.companyId))
      ? Number(opts.companyId)
      : null;
  const excludeId =
    opts.excludeVacancyId != null && Number.isFinite(Number(opts.excludeVacancyId))
      ? Number(opts.excludeVacancyId)
      : null;
  const q = String(opts.q || '')
    .trim()
    .slice(0, 120);
  const employmentType = normalizeEmploymentType(opts.employmentType);
  const workplaceModality = normalizeWorkplaceModality(opts.workplaceModality);
  const workplaceCities = (() => {
    const fromArr = Array.isArray(opts.workplaceCities) ? opts.workplaceCities : [];
    const single = opts.workplaceCity != null ? [opts.workplaceCity] : [];
    const merged = [...fromArr, ...single]
      .map((c) => normalizeWorkplaceCity(c))
      .filter(Boolean);
    return [...new Set(merged)];
  })();

  const params = [];
  const where = [
    'v.deleted = FALSE',
    'c.deleted = FALSE',
    'c.active = TRUE',
    'v.public_page_enabled = TRUE',
    'v.public_allow_index = TRUE',
    `v.status = '${VACANCY_STATUS.OPEN}'`,
    '(v.target_date IS NULL OR v.target_date >= CURRENT_DATE)',
  ];

  if (excludeId != null) {
    params.push(excludeId);
    where.push(`v.id <> $${params.length}`);
  }
  if (companyId != null && !wantPaged) {
    // Relacionadas: prefer same company in ORDER, not hard filter
  }
  if (companyId != null && opts.filterCompanyId === true) {
    params.push(companyId);
    where.push(`v.company_id = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.replace(/[%_]/g, '')}%`);
    where.push(
      `(v.title ILIKE $${params.length} OR (v.public_show_company_info = TRUE AND c.name ILIKE $${params.length}))`
    );
  }
  if (employmentType) {
    params.push(employmentType);
    where.push(`v.employment_type = $${params.length}`);
  }
  if (workplaceModality) {
    params.push(workplaceModality);
    where.push(`v.workplace_modality = $${params.length}`);
  }
  if (workplaceCities.length === 1) {
    params.push(workplaceCities[0]);
    where.push(`LOWER(btrim(v.workplace_city)) = LOWER(btrim($${params.length}))`);
  } else if (workplaceCities.length > 1) {
    params.push(workplaceCities.map((c) => c.toLowerCase()));
    where.push(`LOWER(btrim(v.workplace_city)) = ANY($${params.length}::text[])`);
  }

  const orderParts = [];
  if (companyId != null && !opts.filterCompanyId) {
    params.push(companyId);
    orderParts.push(`CASE WHEN v.company_id = $${params.length} THEN 0 ELSE 1 END`);
  }
  orderParts.push('v.created_at DESC');

  let total = null;
  if (wantPaged) {
    const countRes = await queryRead(
      `SELECT COUNT(*)::int AS n
       FROM vacancies v
       JOIN companies c ON c.id = v.company_id
       WHERE ${where.join(' AND ')}`,
      params
    );
    total = Number(countRes.rows[0]?.n) || 0;
  }

  params.push(pageSize);
  const limI = params.length;
  params.push(wantPaged ? offset : 0);
  const offI = params.length;

  const r = await queryRead(
    `SELECT
       v.id AS "vacancyId",
       v.title,
       v.slug AS "vacancySlug",
       v.employment_type AS "employmentType",
       v.workplace_modality AS "workplaceModality",
       v.workplace_city AS "workplaceCity",
       v.workplace_state AS "workplaceState",
       v.salary_min AS "salaryMin",
       v.salary_max AS "salaryMax",
       v.target_date AS "targetDate",
       v.public_show_company_info AS "publicShowCompanyInfo",
       v.public_show_salary AS "publicShowSalary",
       c.id AS "companyId",
       c.name AS "companyName",
       c.slug AS "companySlug",
       c.public_profile_enabled AS "publicProfileEnabled"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderParts.join(', ')}
     LIMIT $${limI} OFFSET $${offI}`,
    params
  );

  const items = (r.rows || []).map((row) => {
    const showCompany = Boolean(row.publicShowCompanyInfo);
    const showSalary = Boolean(row.publicShowSalary);
    const path = publicVacancyPath({ vacancySlug: row.vacancySlug, vacancyId: row.vacancyId });
    const profileOn = Boolean(row.publicProfileEnabled);
    return {
      vacancyId: row.vacancyId,
      title: row.title,
      vacancySlug: row.vacancySlug,
      employmentType: row.employmentType || null,
      workplaceModality: row.workplaceModality || null,
      workplaceCity: row.workplaceCity || null,
      workplaceState: row.workplaceState || null,
      salaryMin: showSalary ? row.salaryMin : null,
      salaryMax: showSalary ? row.salaryMax : null,
      showSalary,
      targetDate: row.targetDate ? String(row.targetDate).slice(0, 10) : null,
      path,
      url: publicVacancyAbsoluteUrl({ vacancySlug: row.vacancySlug, vacancyId: row.vacancyId }),
      companyName: showCompany ? row.companyName : null,
      // Link /c/{slug} só se a empresa optou pelo perfil público
      companySlug: showCompany && profileOn ? row.companySlug : null,
    };
  });

  if (!wantPaged) return items;
  return { items, total, page, pageSize };
}

/**
 * Perfil público da empresa por slug (página `/c/{slug}`).
 * Exige public_profile_enabled (opt-in; default off na criação).
 * @returns {{ ok: true, company: object } | { ok: false, errorCode: string, status?: number }}
 */
export async function resolvePublicCompanyBySlug(companySlug) {
  const slug = String(companySlug || '')
    .trim()
    .toLowerCase();
  if (!slug) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };

  const r = await queryRead(
    `SELECT
       c.id AS "companyId",
       c.name,
       c.slug,
       c.website,
       c.about_html AS "aboutHtml",
       c.logo_url AS "logoUrl"
     FROM companies c
     WHERE LOWER(c.slug) = $1
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND c.public_profile_enabled = TRUE
     LIMIT 1`,
    [slug]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };
  return { ok: true, company: r.rows[0] };
}

const SITEMAP_CAP = 5000;

/**
 * Entradas para sitemap (só vagas open + página + indexáveis).
 * @param {{ limit?: number }} [opts]
 */
export async function listSitemapPublicEntries(opts = {}) {
  const limitRaw = Number(opts.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(SITEMAP_CAP, Math.max(1, Math.floor(limitRaw)))
    : SITEMAP_CAP;

  const r = await queryRead(
    `SELECT
       v.id AS "vacancyId",
       v.slug AS "vacancySlug",
       v.created_at AS "createdAt",
       c.slug AS "companySlug"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE v.deleted = FALSE
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND v.public_page_enabled = TRUE
       AND v.public_allow_index = TRUE
       AND v.status = '${VACANCY_STATUS.OPEN}'
       AND (v.target_date IS NULL OR v.target_date >= CURRENT_DATE)
     ORDER BY v.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return (r.rows || []).map((row) => {
    const path = publicVacancyPath({ vacancySlug: row.vacancySlug, vacancyId: row.vacancyId });
    return {
      vacancyId: row.vacancyId,
      path,
      url: publicVacancyAbsoluteUrl({ vacancySlug: row.vacancySlug, vacancyId: row.vacancyId }),
      lastModified: row.createdAt ? new Date(row.createdAt) : new Date(),
    };
  });
}

/**
 * Meta description (plain text) a partir do HTML da vaga.
 */
export function postingMetaDescription(posting, locale = 'pt-BR') {
  const en = contentLocale(locale) === 'en';
  if (publicVacancyShowsClosedExperience(posting)) {
    return i18nT(locale, 'ui.publicVacancyPosting.thisRoleIsNoLonger');
  }
  const fromDesc = clipPlain(htmlToPlainText(posting?.description || ''), 155);
  if (fromDesc) return fromDesc;
  const title = posting?.title || (i18nT(locale, 'ui.publicVacancyPosting.openRole'));
  const company = posting?.showCompany && posting?.company?.name ? posting.company.name : null;
  const bits = [title];
  if (company) bits.push(i18nT(locale, 'ui.publicVacancyPosting.at', { company }));
  const emp = normalizeEmploymentType(posting?.employmentType);
  if (emp === 'clt') bits.push(en ? 'CLT' : 'CLT');
  else if (emp === 'pj') bits.push(i18nT(locale, 'ui.publicVacancyPosting.contractor'));
  else if (emp === 'internship') bits.push(i18nT(locale, 'ui.publicVacancyPosting.internship'));
  else if (emp === 'cooperative') bits.push(i18nT(locale, 'ui.publicVacancyPosting.cooperative'));
  if (posting?.showSalary && (posting.salaryMin || posting.salaryMax)) {
    bits.push(i18nT(locale, 'ui.publicVacancyPosting.salaryRangeListed'));
  }
  bits.push(i18nT(locale, 'ui.publicVacancyPosting.applyNow'));
  return clipPlain(bits.join(' ').replace(/\s+/g, ' '), 160);
}

/**
 * JSON-LD JobPosting (Google for Jobs + crawlers de IA).
 * Só incluir campos autorizados pelas flags; sem inventar localização.
 */
export function buildJobPostingJsonLd(posting, locale = 'pt-BR') {
  if (!posting) return null;
  // Fechada / prazo vencido / sem index: não publicar JobPosting.
  if (publicVacancyShowsClosedExperience(posting) || !posting.publicAllowIndex) return null;
  const descriptionHtml = String(posting.description || '').trim();
  const descriptionPlain = clipPlain(htmlToPlainText(descriptionHtml), 5000) || posting.title;

  const orgName =
    posting.showCompany && posting.company?.name
      ? posting.company.name
      : i18nT(locale, 'ui.publicVacancyPosting.hiringCompany');

  const hiringOrganization = {
    '@type': 'Organization',
    name: orgName,
  };
  if (posting.showCompany && posting.company?.website) {
    hiringOrganization.sameAs = posting.company.website;
    hiringOrganization.url = posting.company.website;
  }
  if (posting.showCompany && posting.company?.logoUrl) {
    hiringOrganization.logo = posting.company.logoUrl;
  }

  const emp = schemaEmploymentType(posting.employmentType);
  const datePosted = posting.createdAt
    ? new Date(posting.createdAt).toISOString().slice(0, 10)
    : undefined;
  let validThrough;
  if (posting.targetDate) {
    const raw = posting.targetDate;
    let d = '';
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      d = raw.toISOString().slice(0, 10);
    } else {
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = s.slice(0, 10);
      else {
        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) d = parsed.toISOString().slice(0, 10);
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) validThrough = `${d}T23:59:59-03:00`;
  }

  const json = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: posting.title,
    description: descriptionHtml || descriptionPlain,
    datePosted,
    hiringOrganization,
    identifier: {
      '@type': 'PropertyValue',
      name: orgName,
      value: String(posting.vacancyId),
    },
    url: posting.pageUrl || undefined,
    directApply: Boolean(posting.applyUrl),
  };

  if (validThrough) json.validThrough = validThrough;
  if (emp) json.employmentType = emp;

  const modality = normalizeWorkplaceModality(posting.workplaceModality);
  const city = normalizeWorkplaceCity(posting.workplaceCity);
  const state = normalizeWorkplaceState(posting.workplaceState);

  // Escopo do produto é Brasil — Country como requisito de candidatura.
  json.applicantLocationRequirements = {
    '@type': 'Country',
    name: i18nT(locale, 'ui.publicVacancyPosting.brazil'),
  };

  if (modality === 'remote' || modality === 'hybrid') {
    json.jobLocationType = 'TELECOMMUTE';
  }
  if (city || state || modality === 'onsite' || modality === 'hybrid') {
    const address = {
      '@type': 'PostalAddress',
      addressCountry: 'BR',
    };
    if (city) address.addressLocality = city;
    if (state) address.addressRegion = state;
    if (city || state) {
      json.jobLocation = {
        '@type': 'Place',
        address,
      };
    }
  }

  if (posting.showSalary && (posting.salaryMin || posting.salaryMax)) {
    const min = salaryAmountNumber(posting.salaryMin);
    const max = salaryAmountNumber(posting.salaryMax);
    if (min != null || max != null) {
      const value = { '@type': 'QuantitativeValue', unitText: 'MONTH' };
      if (min != null) value.minValue = min;
      if (max != null) value.maxValue = max;
      if (min != null && max == null) value.value = min;
      json.baseSalary = {
        '@type': 'MonetaryAmount',
        currency: 'BRL',
        value,
      };
    }
  }

  return json;
}

/** Escape seguro para embutir JSON-LD em <script> (evita fechar a tag). */
export function serializeJsonLdForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
