/** Shared assessment list filters (dashboard + APIs). */

import { canAccessDashboardTab } from './permissions.js';
import { PIPELINE_STAGE_SET } from './recruiting/pipeline.js';
import { ROSTER_SCOPE, ROSTER_SCOPE_SET } from './domain-status.js';
import { rosterScopeSqlPart } from './roster-scope-sql.js';

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
export { ROSTER_SCOPE, ROSTER_SCOPE_SET };

const VALID_TAB_IDS = new Set([
  'organization',
  'overview',
  'analytics',
  'team',
  'pdi',
  'compatibility',
  'compare',
  'group',
  'leadership',
  'vacancies',
  'talent-bank',
  'motivators',
  'climate',
  'whistleblowing',
  'companies',
  'users',
  'leads',
  'subscriptions',
  'product-feedback',
  'digital-certificate',
  'audit',
  'job-roles',
  'performance-reviews',
  'okr',
  'succession',
  'exit-analysis',
  'learning-resources',
  'lms',
  'company-benefits',
  'company-feed',
  'compensation',
  'dp',
  'help',
  'profile',
]);

/** Prefer first module the session can open; profile.self is always last resort. */
const TAB_FALLBACK_ORDER = [
  'overview',
  'analytics',
  'team',
  'pdi',
  'compensation',
  'dp',
  'compatibility',
  'compare',
  'group',
  'leadership',
  'vacancies',
  'talent-bank',
  'motivators',
  'climate',
  'whistleblowing',
  'companies',
  'users',
  'leads',
  'subscriptions',
  'product-feedback',
  'digital-certificate',
  'audit',
  'job-roles',
  'performance-reviews',
  'okr',
  'succession',
  'exit-analysis',
  'learning-resources',
  'lms',
  'company-benefits',
  'company-feed',
  'help',
  'profile',
];

/**
 * @param {Record<string, string | string[] | undefined> | URLSearchParams} searchParams
 * @param {{ role?: string } | null | undefined} sessionPayload — JWT/session shape (`role`, …)
 */
export function parseDashboardTab(searchParams, sessionPayload) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('tab') || '').toString()
      : String(searchParams?.tab ?? '').trim();
  const id = raw && VALID_TAB_IDS.has(raw) ? raw : 'overview';
  if (canAccessDashboardTab(sessionPayload, id)) return id;
  for (const tab of TAB_FALLBACK_ORDER) {
    if (canAccessDashboardTab(sessionPayload, tab)) return tab;
  }
  return 'profile';
}

const TEAM_SORT_KEYS = new Set(['createdAt', 'name', 'area', 'type', 'vacancy', 'pipeline']);

/** @returns {{ sort: string, dir: 'asc' | 'desc' }} */
export function parseTeamSort(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('teamSort') || '').toString()
      : String(searchParams?.teamSort ?? '').trim();
  const sort = TEAM_SORT_KEYS.has(raw) ? raw : 'createdAt';
  const dRaw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('teamSortDir') || 'desc').toString()
      : String(searchParams?.teamSortDir ?? 'desc').toLowerCase();
  const dir = dRaw === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

/** SQL ORDER BY fragment (whitelist only — injetar apenas com parseTeamSort). */
export function sqlTeamOrderBy(sort, dir) {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'name':
      return `ORDER BY LOWER(c.full_name) ${d}, ass.id DESC`;
    case 'area':
      return `ORDER BY ar.label ${d}, ass.id DESC`;
    case 'type':
      return `ORDER BY ass.top_type ${d}, ass.id DESC`;
    case 'vacancy':
      return `ORDER BY COALESCE(v.title, '') ${d}, ass.id DESC`;
    case 'pipeline':
      return `ORDER BY ass.pipeline_stage ${d}, ass.created_at DESC, ass.id DESC`;
    case 'createdAt':
    default:
      return `ORDER BY ass.created_at ${d}, ass.id DESC`;
  }
}

const VACANCY_SORT_KEYS = new Set(['createdAt', 'title', 'status', 'companyName', 'id']);

/** @param {{ isAdmin: boolean }} ctx — não-admin não usa companyName na ordenação */
export function parseVacanciesSort(searchParams, ctx = {}) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('vacanciesSort') || searchParams.get('sort') || '').toString()
      : String(searchParams?.vacanciesSort ?? searchParams?.sort ?? '').trim();
  let sort = VACANCY_SORT_KEYS.has(raw) ? raw : 'createdAt';
  if (!ctx.isAdmin && sort === 'companyName') sort = 'createdAt';
  const dRaw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('vacanciesSortDir') || searchParams.get('sortDir') || 'desc').toString()
      : String(searchParams?.vacanciesSortDir ?? searchParams?.sortDir ?? 'desc').toLowerCase();
  const dir = dRaw === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

/** SQL ORDER BY para listagem paginada de vagas */
export function sqlVacancyOrderBy(sort, dir) {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'title':
      return `ORDER BY v.title ${d}, v.id DESC`;
    case 'status':
      return `ORDER BY v.status ${d}, v.id DESC`;
    case 'companyName':
      return `ORDER BY c.name ${d}, v.id DESC`;
    case 'id':
      return `ORDER BY v.id ${d}`;
    case 'createdAt':
    default:
      return `ORDER BY v.created_at ${d}, v.id DESC`;
  }
}

/** @returns {{ page: number, pageSize: number }} — lê teamPage/teamPageSize; fallback legacy page/pageSize */
export function parseTeamPagination(searchParams) {
  const pageRaw = parseInt(
    String(searchParams?.teamPage ?? searchParams?.page ?? '1'),
    10
  );
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const sizeRaw = parseInt(
    String(searchParams?.teamPageSize ?? searchParams?.pageSize ?? '20'),
    10
  );
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

/** @returns {{ page: number, pageSize: number }} */
export function parseVacanciesPagination(searchParams) {
  const pageRaw = parseInt(String(searchParams?.vacanciesPage ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(String(searchParams?.vacanciesPageSize ?? '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

/** @returns {{ page: number, pageSize: number }} */
export function parseComparePagination(searchParams) {
  const pageRaw = parseInt(String(searchParams?.comparePage ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(String(searchParams?.comparePageSize ?? '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

/** Paginação da aba Compatibilidade (lista de pares). */
export function parseCompatTabPagination(searchParams) {
  const pageRaw = parseInt(String(searchParams?.compatPage ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(String(searchParams?.compatPageSize ?? '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

const USER_SORT_KEYS = new Set(['id', 'email', 'displayName', 'role', 'companyName', 'active', 'createdAt']);

/** @returns {{ sort: string, dir: 'asc' | 'desc' }} */
export function parseUsersSort(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('usersSort') || '').toString()
      : String(searchParams?.usersSort ?? '').trim();
  const sort = USER_SORT_KEYS.has(raw) ? raw : 'createdAt';
  const dRaw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('usersSortDir') || 'desc').toString()
      : String(searchParams?.usersSortDir ?? 'desc').toLowerCase();
  const dir = dRaw === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

/** SQL ORDER BY — usar apenas com parseUsersSort. */
export function sqlUsersOrderBy(sort, dir) {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'email':
      return `ORDER BY LOWER(u.email) ${d}, u.id DESC`;
    case 'displayName':
      return `ORDER BY LOWER(COALESCE(u.display_name, '')) ${d}, u.id DESC`;
    case 'role':
      return `ORDER BY u.role ${d}, u.id DESC`;
    case 'companyName':
      return `ORDER BY LOWER(COALESCE(c.name, '')) ${d}, u.id DESC`;
    case 'active':
      return `ORDER BY u.active ${d}, u.id DESC`;
    case 'id':
      return `ORDER BY u.id ${d}`;
    case 'createdAt':
    default:
      return `ORDER BY u.created_at ${d}, u.id DESC`;
  }
}

/** @returns {{ page: number, pageSize: number }} */
export function parseUsersPagination(searchParams) {
  const pageRaw = parseInt(String(searchParams?.usersPage ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(String(searchParams?.usersPageSize ?? '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

const COMPANY_SORT_KEYS = new Set(['id', 'name', 'slug', 'active', 'createdAt']);

/** @returns {{ sort: string, dir: 'asc' | 'desc' }} */
export function parseCompaniesSort(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('companiesSort') || '').toString()
      : String(searchParams?.companiesSort ?? '').trim();
  const sort = COMPANY_SORT_KEYS.has(raw) ? raw : 'createdAt';
  const dRaw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('companiesSortDir') || 'desc').toString()
      : String(searchParams?.companiesSortDir ?? 'desc').toLowerCase();
  const dir = dRaw === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

/** SQL ORDER BY — usar apenas com parseCompaniesSort. */
export function sqlCompaniesOrderBy(sort, dir) {
  const d = dir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'name':
      return `ORDER BY LOWER(c.name) ${d}, c.id DESC`;
    case 'slug':
      return `ORDER BY LOWER(c.slug) ${d}, c.id DESC`;
    case 'active':
      return `ORDER BY c.active ${d}, c.id DESC`;
    case 'id':
      return `ORDER BY c.id ${d}`;
    case 'createdAt':
    default:
      return `ORDER BY c.created_at ${d}, c.id DESC`;
  }
}

/** @returns {{ page: number, pageSize: number }} */
export function parseCompaniesPagination(searchParams) {
  const pageRaw = parseInt(String(searchParams?.companiesPage ?? '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(String(searchParams?.companiesPageSize ?? '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  return { page, pageSize };
}

/** @returns {string} — busca por nome de candidato (server-side, case-insensitive) */
export function parseNameSearch(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('search') || '').toString()
      : String(searchParams?.search ?? '');
  return raw.trim().slice(0, 200);
}

/**
 * Name/email search clause for candidates alias (param already includes `%…%`).
 * @param {string} [alias='c']
 * @param {number} paramIndex
 */
export function candidateNameSearchClause(alias = 'c', paramIndex) {
  const a = alias || 'c';
  const i = Number(paramIndex);
  if (!Number.isFinite(i) || i < 1) return 'TRUE';
  return `(${a}.full_name ILIKE $${i} OR COALESCE(${a}.email, '') ILIKE $${i})`;
}

/** @returns {string} */
export function parseEnneagramFilter(searchParams) {
  const enneRaw = String(searchParams?.enneagram ?? searchParams?.profile ?? 'all').trim();
  if (/^[1-9]$/.test(enneRaw)) return enneRaw;
  return 'all';
}

/** @param {Record<string, string | string[] | undefined> | URLSearchParams} searchParams */
export function parsePipelineFilter(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('pipeline') || '').toString()
      : String(searchParams?.pipeline ?? '').trim();
  return PIPELINE_STAGE_SET.has(raw) ? raw : 'all';
}

const ROSTER_SCOPES = ROSTER_SCOPE_SET;

/**
 * Separates internal team (company-link / hired employees) from vacancy recruiting.
 * Default: internal — so Teach/vacancy candidates do not pollute Equipe.
 * @param {Record<string, string | string[] | undefined> | URLSearchParams} searchParams
 */
export function parseRosterScope(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('roster') || '').toString()
      : String(searchParams?.roster ?? '').trim();
  return ROSTER_SCOPES.has(raw) ? raw : ROSTER_SCOPE.INTERNAL;
}

/** Equipe deep-link filters (URL `filter=`). */
export const TEAM_LIST_FILTER = Object.freeze({
  TURNOVER_RISK: 'turnover_risk',
});

const TEAM_LIST_FILTER_SET = new Set(Object.values(TEAM_LIST_FILTER));

/**
 * Optional list focus on Equipe (e.g. medium/high turnover from hr_scores).
 * @returns {string|null}
 */
export function parseTeamListFilter(searchParams) {
  const raw =
    typeof searchParams?.get === 'function'
      ? (searchParams.get('filter') || '').toString()
      : String(searchParams?.filter ?? '').trim();
  return TEAM_LIST_FILTER_SET.has(raw) ? raw : null;
}

/** @returns {{ page: number, pageSize: number, enneagram: string }} */
export function parseDashboardPagination(searchParams) {
  const { page, pageSize } = parseTeamPagination(searchParams);
  const enneagram = parseEnneagramFilter(searchParams);
  return { page, pageSize, enneagram };
}

/** @returns {{ dateFrom: string|null, dateTo: string|null }} — formato YYYY-MM-DD */
export function parseDateFilter(searchParams) {
  const get = (k) =>
    typeof searchParams?.get === 'function'
      ? (searchParams.get(k) || '')
      : String(searchParams?.[k] ?? '');
  const validate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : null);
  return { dateFrom: validate(get('dateFrom')), dateTo: validate(get('dateTo')) };
}

/**
 * Effective tenant for cohort lists (Equipe / Comparativo / Grupos / Liderança / Overview).
 * - hr/direction: always session company
 * - admin with home company (tenant-bound): always home — never "all companies"
 * - super-admin (no home company): optional chip `scopeCompanyFilter`, else unscoped (null)
 * @returns {number|null}
 */
export function resolveCohortCompanyId({ isAdmin, companyId, scopeCompanyFilter }) {
  const homeRaw = companyId != null && companyId !== '' ? Number(companyId) : NaN;
  const home = Number.isFinite(homeRaw) && homeRaw > 0 ? homeRaw : null;
  const chipRaw =
    scopeCompanyFilter != null && scopeCompanyFilter !== '' && scopeCompanyFilter !== 'all'
      ? Number(scopeCompanyFilter)
      : NaN;
  const chip = Number.isFinite(chipRaw) && chipRaw > 0 ? chipRaw : null;

  if (!isAdmin) return home;

  // Tenant-bound admin: never cross tenants (ignore company=all / other chips).
  if (home != null) return home;

  // Super-admin: chip scopes; null = all companies.
  return chip;
}

/**
 * @returns {{ whereParts: string[], params: unknown[] }}
 * Cláusulas para WHERE em queries que já fazem JOIN em candidates, areas, vacancies (LEFT).
 */
export function assessmentListWhereParts({
  isAdmin,
  companyId,
  scopeCompanyFilter,
  selectedArea,
  selectedVacancy,
  enneagram = 'all',
  pipelineStage = 'all',
  dateFrom = null,
  dateTo = null,
  rosterScope = ROSTER_SCOPE.INTERNAL,
  listFilter = null,
}) {
  const whereParts = [];
  const params = [];

  const effectiveCompanyId = resolveCohortCompanyId({ isAdmin, companyId, scopeCompanyFilter });
  if (effectiveCompanyId != null) {
    params.push(effectiveCompanyId);
    whereParts.push(`ass.company_id = $${params.length}`);
  }

  if (selectedArea !== 'all') {
    params.push(selectedArea);
    whereParts.push(`ar.key = $${params.length}`);
  }

  const vacRaw = String(selectedVacancy ?? 'all').trim();
  const vacancyPinned = vacRaw !== 'all';
  if (vacancyPinned) {
    const vid = parseInt(vacRaw, 10);
    if (Number.isFinite(vid)) {
      params.push(vid);
      whereParts.push(`ass.vacancy_id = $${params.length}`);
    }
  }

  // Roster scope applies only when not pinned to a single vacancy.
  const rosterPart = vacancyPinned ? null : rosterScopeSqlPart(rosterScope);
  if (rosterPart) whereParts.push(rosterPart);

  if (enneagram !== 'all') {
    const t = parseInt(String(enneagram), 10);
    if (t >= 1 && t <= 9) {
      params.push(t);
      whereParts.push(`ass.top_type = $${params.length}`);
    }
  }

  if (pipelineStage !== 'all' && PIPELINE_STAGE_SET.has(String(pipelineStage))) {
    params.push(String(pipelineStage));
    // Match rows where the raw stage_key equals the canonical bucket (legacy /
    // seed) OR whose company-scoped canonical_key resolves to it (custom).
    whereParts.push(`(
      ass.pipeline_stage = $${params.length}
      OR EXISTS (
        SELECT 1 FROM company_pipeline_stages cps
        WHERE cps.company_id = ass.company_id
          AND cps.stage_key = ass.pipeline_stage
          AND cps.deleted_at IS NULL
          AND cps.canonical_key = $${params.length}
      )
    )`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    whereParts.push(`ass.created_at >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    whereParts.push(`ass.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  if (listFilter === TEAM_LIST_FILTER.TURNOVER_RISK) {
    // Tenant-safe: hr_scores.company_id must match assessment company
    whereParts.push(`EXISTS (
      SELECT 1 FROM hr_scores hs
      WHERE hs.candidate_id = c.id
        AND hs.company_id = ass.company_id
        AND hs.turnover_risk IN ('medium', 'high')
    )`);
  }

  return { whereParts, params };
}

export function sqlWhere(whereParts) {
  return whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
}
