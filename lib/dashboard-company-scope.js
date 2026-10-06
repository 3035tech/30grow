/**
 * Dashboard company scope — shared tab sets + sticky company for super admin.
 * Keep DashboardClient SSR (load-dashboard-data) and client chrome in sync.
 */

/** Tabs that use the shared assessment filter chrome (area/vacancy/hist). */
export const COHORT_TABS = Object.freeze(
  new Set(['overview', 'team', 'compatibility', 'compare', 'group', 'leadership'])
);

/**
 * Admin tabs scoped by company (picker; no full cohort chrome).
 * Mutations/list APIs expect companyId for cross-tenant admin.
 */
export const COMPANY_SCOPE_TABS = Object.freeze(
  new Set([
    'organization',
    'talent-bank',
    'analytics',
    'job-roles',
    'performance-reviews',
    'okr',
    'succession',
    'exit-analysis',
    'dp',
    'learning-resources',
    'lms',
    'company-benefits',
    'company-feed',
    'compensation',
    'whistleblowing',
  ])
);

/** Tabs that need the companies list in SSR (picker or in-tab select). */
export function needsAdminCompaniesList(activeTab) {
  return (
    COHORT_TABS.has(activeTab) ||
    COMPANY_SCOPE_TABS.has(activeTab) ||
    activeTab === 'motivators' ||
    activeTab === 'climate' ||
    activeTab === 'whistleblowing' ||
    activeTab === 'audit'
  );
}

export function isCompanyScopeTab(activeTab) {
  return COMPANY_SCOPE_TABS.has(activeTab);
}

export const DASHBOARD_COMPANY_STORAGE_KEY = 'team30_dashboard_company';

export function readStickyCompanyId() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_COMPANY_STORAGE_KEY);
    const n = parseInt(String(raw || '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeStickyCompanyId(companyId) {
  if (typeof window === 'undefined') return;
  try {
    if (companyId == null || companyId === '' || companyId === 'all') {
      window.localStorage.removeItem(DASHBOARD_COMPANY_STORAGE_KEY);
      return;
    }
    const n = Number(companyId);
    if (Number.isFinite(n) && n > 0) {
      window.localStorage.setItem(DASHBOARD_COMPANY_STORAGE_KEY, String(n));
    }
  } catch {
    /* private mode / quota */
  }
}

export function companyInList(companies, companyId) {
  const n = Number(companyId);
  if (!Number.isFinite(n) || n <= 0) return false;
  return (companies || []).some((c) => Number(c.id) === n);
}

/**
 * Prefer URL company, else sticky if still in the companies list,
 * else the sole company when the admin list has exactly one tenant.
 * @returns {string|null} numeric id string or null for "all"
 */
export function resolveStickyCompanyPreference({ urlCompany, companies }) {
  const fromUrl = urlCompany && urlCompany !== 'all' ? String(urlCompany) : null;
  if (fromUrl && companyInList(companies, fromUrl)) return fromUrl;
  const sticky = readStickyCompanyId();
  if (sticky != null && companyInList(companies, sticky)) return String(sticky);
  if (Array.isArray(companies) && companies.length === 1) {
    const id = Number(companies[0]?.id);
    if (Number.isFinite(id) && id > 0) return String(id);
  }
  return null;
}

/**
 * B-2804.6 — menu tab switch without the SSR loader. Cohort tabs need tab-scoped server
 * data; every other tab fetches its own, so only the admin companies list (picker / in-tab
 * select) must already be in memory.
 *
 * @param {string} targetTab
 * @param {{ isAdmin?: boolean, companiesLoaded?: boolean }} [opts]
 */
export function canSwitchTabClientOnly(targetTab, { isAdmin = false, companiesLoaded = false } = {}) {
  if (!targetTab || COHORT_TABS.has(targetTab)) return false;
  return !isAdmin || companiesLoaded || !needsAdminCompaniesList(targetTab);
}

