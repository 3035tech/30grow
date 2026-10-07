/**
 * Company commercial modules (SKUs) — above CAP / tabs.
 *
 * Defaults (early adopter, decisions deferred):
 * - companies.enabled_modules NULL → all modules (legacy / skip onboarding)
 * - core always implied when list is set
 * - public tokens stay valid; manager CAP ∩ company modules
 * - module off = hide UI/API surfaces; data kept
 *
 * CAP keys are string literals (same values as CAP in permissions.js) to avoid circular imports.
 */

/** Stable module keys stored in companies.enabled_modules. */
export const COMPANY_MODULE = Object.freeze({
  CORE: 'core',
  ANALYSIS: 'analysis',
  RECRUITING: 'recruiting',
  MOTIVATORS: 'motivators',
  CLIMATE: 'climate',
  PERFORMANCE: 'performance',
  JOB_ROLES: 'job_roles',
  SUCCESSION: 'succession',
  EXIT: 'exit',
  LEARNING: 'learning',
  BENEFITS: 'benefits',
  COMPENSATION: 'compensation',
  DP: 'dp',
  COMPANY_FEED: 'company_feed',
  WHISTLEBLOWING: 'whistleblowing',
});

export const COMPANY_MODULES = Object.freeze(Object.values(COMPANY_MODULE));

/** Always on when a company configures a list. */
export const COMPANY_MODULE_CORE = COMPANY_MODULE.CORE;

/** Selectable keys for onboarding / profile / company drawer (includes locked core). */
export const SELECTABLE_COMPANY_MODULE_IDS = Object.freeze([...COMPANY_MODULES]);

/**
 * Visual groups for checkbox UIs (storage keys stay flat).
 * Order matches early-adopter mental model: core → people analytics → hire → ops.
 */
export const COMPANY_MODULE_UI_GROUPS = Object.freeze([
  Object.freeze({
    id: 'core',
    moduleIds: Object.freeze([COMPANY_MODULE.CORE]),
  }),
  Object.freeze({
    id: 'people',
    moduleIds: Object.freeze([
      COMPANY_MODULE.ANALYSIS,
      COMPANY_MODULE.MOTIVATORS,
      COMPANY_MODULE.CLIMATE,
      COMPANY_MODULE.PERFORMANCE,
      COMPANY_MODULE.SUCCESSION,
      COMPANY_MODULE.EXIT,
    ]),
  }),
  Object.freeze({
    id: 'hire',
    moduleIds: Object.freeze([COMPANY_MODULE.RECRUITING, COMPANY_MODULE.JOB_ROLES]),
  }),
  Object.freeze({
    id: 'ops',
    moduleIds: Object.freeze([
      COMPANY_MODULE.LEARNING,
      COMPANY_MODULE.BENEFITS,
      COMPANY_MODULE.COMPENSATION,
      COMPANY_MODULE.DP,
      COMPANY_MODULE.COMPANY_FEED,
      COMPANY_MODULE.WHISTLEBLOWING,
    ]),
  }),
]);

const PROFILE_SELF = 'profile.self';
const USERS_MANAGE = 'users.manage';
const COMPANIES_MANAGE = 'companies.manage';

/**
 * Module → CAP keys the module unlocks for managers.
 * profile.self is never gated by modules.
 */
export const MODULE_TO_CAPS = Object.freeze({
  [COMPANY_MODULE.CORE]: Object.freeze(['overview.view', 'team.view', 'help.view']),
  [COMPANY_MODULE.ANALYSIS]: Object.freeze([
    'compatibility.view',
    'compare.view',
    'group.view',
    'leadership.view',
  ]),
  [COMPANY_MODULE.RECRUITING]: Object.freeze(['vacancies.view', 'vacancies.manage']),
  [COMPANY_MODULE.MOTIVATORS]: Object.freeze(['motivators.view', 'motivators.config']),
  [COMPANY_MODULE.CLIMATE]: Object.freeze(['climate.view']),
  [COMPANY_MODULE.PERFORMANCE]: Object.freeze(['performance.view']),
  [COMPANY_MODULE.JOB_ROLES]: Object.freeze(['job_roles.view']),
  [COMPANY_MODULE.SUCCESSION]: Object.freeze(['succession.view']),
  [COMPANY_MODULE.EXIT]: Object.freeze(['exit_analysis.view']),
  [COMPANY_MODULE.LEARNING]: Object.freeze(['learning.view']),
  [COMPANY_MODULE.BENEFITS]: Object.freeze(['benefits.view']),
  [COMPANY_MODULE.COMPENSATION]: Object.freeze(['compensation.view', 'compensation.manage']),
  [COMPANY_MODULE.DP]: Object.freeze(['dp.view']),
  [COMPANY_MODULE.COMPANY_FEED]: Object.freeze(['company_feed.view']),
  [COMPANY_MODULE.WHISTLEBLOWING]: Object.freeze(['whistleblowing.view']),
});

/** Dashboard tabs gated by company module (beyond CAP). */
export const MODULE_TO_TABS = Object.freeze({
  [COMPANY_MODULE.CORE]: Object.freeze(['overview', 'analytics', 'team', 'pdi', 'help', 'profile']),
  [COMPANY_MODULE.ANALYSIS]: Object.freeze(['compatibility', 'compare', 'group', 'leadership']),
  [COMPANY_MODULE.RECRUITING]: Object.freeze(['vacancies', 'talent-bank']),
  [COMPANY_MODULE.MOTIVATORS]: Object.freeze(['motivators']),
  [COMPANY_MODULE.CLIMATE]: Object.freeze(['climate']),
  [COMPANY_MODULE.PERFORMANCE]: Object.freeze(['performance-reviews', 'okr']),
  [COMPANY_MODULE.JOB_ROLES]: Object.freeze(['job-roles']),
  [COMPANY_MODULE.SUCCESSION]: Object.freeze(['succession']),
  [COMPANY_MODULE.EXIT]: Object.freeze(['exit-analysis']),
  [COMPANY_MODULE.LEARNING]: Object.freeze(['learning-resources', 'lms']),
  [COMPANY_MODULE.BENEFITS]: Object.freeze(['company-benefits']),
  [COMPANY_MODULE.COMPENSATION]: Object.freeze(['compensation']),
  [COMPANY_MODULE.DP]: Object.freeze(['dp']),
  [COMPANY_MODULE.COMPANY_FEED]: Object.freeze(['company-feed']),
  [COMPANY_MODULE.WHISTLEBLOWING]: Object.freeze(['whistleblowing']),
});

/** Employee home section ids gated by module. */
export const MODULE_TO_EMPLOYEE_SECTIONS = Object.freeze({
  [COMPANY_MODULE.CORE]: Object.freeze([
    'tasks',
    'journey',
    'pdi',
    'oneOnOne',
    'feedback',
    'company',
  ]),
  [COMPANY_MODULE.CLIMATE]: Object.freeze(['surveys']),
  [COMPANY_MODULE.PERFORMANCE]: Object.freeze(['okr', 'formalReviews']),
  [COMPANY_MODULE.LEARNING]: Object.freeze(['lms']),
  [COMPANY_MODULE.DP]: Object.freeze(['dp', 'timeClock', 'field']),
  [COMPANY_MODULE.COMPANY_FEED]: Object.freeze(['feed', 'kudos']),
  [COMPANY_MODULE.BENEFITS]: Object.freeze(['variablePay']),
  [COMPANY_MODULE.COMPENSATION]: Object.freeze(['variablePay']),
});

/**
 * Canonical read model for navigation, entitlements and Help consumers.
 * Compatibility maps above remain exported while callers migrate incrementally.
 */
export const COMPANY_MODULE_REGISTRY = Object.freeze(
  COMPANY_MODULES.map((id) => {
    const group = COMPANY_MODULE_UI_GROUPS.find((item) => item.moduleIds.includes(id))?.id || 'ops';
    return Object.freeze({
      id,
      group,
      required: id === COMPANY_MODULE_CORE,
      sensitive: id === COMPANY_MODULE.COMPENSATION || id === COMPANY_MODULE.DP,
      caps: MODULE_TO_CAPS[id] || Object.freeze([]),
      tabs: MODULE_TO_TABS[id] || Object.freeze([]),
      employeeSections: MODULE_TO_EMPLOYEE_SECTIONS[id] || Object.freeze([]),
    });
  })
);

const MODULE_SET = new Set(COMPANY_MODULES);

export function isCompanyModuleKey(raw) {
  return MODULE_SET.has(String(raw || '').trim());
}

const TAB_TO_MODULE = new Map(
  Object.entries(MODULE_TO_TABS).flatMap(([moduleId, tabs]) => tabs.map((tab) => [tab, moduleId]))
);

/** Commercial module that owns a dashboard tab, or null (e.g. admin-only tabs). */
export function moduleForTab(tabId) {
  return TAB_TO_MODULE.get(String(tabId || '').trim()) || null;
}

/**
 * Normalize stored / requested module list.
 * @returns {string[]|null} null = unrestricted (all)
 */
export function normalizeEnabledModules(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const keys = [
    ...new Set(raw.map((k) => String(k || '').trim()).filter((k) => MODULE_SET.has(k))),
  ];
  if (!keys.length) return [COMPANY_MODULE_CORE];
  if (!keys.includes(COMPANY_MODULE_CORE)) keys.unshift(COMPANY_MODULE_CORE);
  return keys.sort();
}

/**
 * For persist: all selectable checked → null (legacy unrestricted).
 * Subset → normalized allow-list (+ core).
 */
export function modulesSelectionForPersist(selectedIds) {
  const selected = new Set(
    (Array.isArray(selectedIds) ? selectedIds : [])
      .map((k) => String(k || '').trim())
      .filter((k) => MODULE_SET.has(k))
  );
  const allOn = SELECTABLE_COMPANY_MODULE_IDS.every((id) => selected.has(id));
  if (allOn) return null;
  if (selected.size === 0) return [COMPANY_MODULE_CORE];
  return normalizeEnabledModules([...selected]);
}

/** UI default when DB is null (unrestricted): all modules checked. */
export function modulesSelectionForUi(enabledModules) {
  const list = normalizeEnabledModules(enabledModules);
  if (list == null) return [...SELECTABLE_COMPANY_MODULE_IDS];
  return [...list];
}

/** Compare two UI selections (order-insensitive). */
export function modulesSelectionEqual(a, b) {
  const sa = [...new Set((a || []).map((k) => String(k || '').trim()).filter(Boolean))].sort().join('\0');
  const sb = [...new Set((b || []).map((k) => String(k || '').trim()).filter(Boolean))].sort().join('\0');
  return sa === sb;
}

/** Caps unlocked by a module allow-list (null = unrestricted). */
export function capsForCompanyModules(enabledModules) {
  const list = normalizeEnabledModules(enabledModules);
  if (list == null) return null;
  const caps = new Set([PROFILE_SELF]);
  for (const m of list) {
    for (const c of MODULE_TO_CAPS[m] || []) caps.add(c);
  }
  return caps;
}

export function companyHasModule(enabledModules, moduleKey) {
  const list = normalizeEnabledModules(enabledModules);
  if (list == null) return true;
  return list.includes(moduleKey);
}

export function tabAllowedByCompanyModules(enabledModules, tabId) {
  const list = normalizeEnabledModules(enabledModules);
  if (list == null) return true;
  const tab = String(tabId || '');
  if (!tab) return false;
  if (
    tab === 'companies' ||
    tab === 'users' ||
    tab === 'leads' ||
    tab === 'audit' ||
    tab === 'product-feedback'
  ) {
    return true;
  }
  for (const m of list) {
    if ((MODULE_TO_TABS[m] || []).includes(tab)) return true;
  }
  return false;
}

export function employeeSectionAllowedByCompanyModules(enabledModules, sectionId) {
  const list = normalizeEnabledModules(enabledModules);
  if (list == null) return true;
  const sid = String(sectionId || '');
  if (sid === 'profile') return true;
  for (const m of list) {
    if ((MODULE_TO_EMPLOYEE_SECTIONS[m] || []).includes(sid)) return true;
  }
  return false;
}

/**
 * Company modules + per-collaborator flags (timeClockEnabled === false hides the time clock).
 * Unknown flags (null/undefined) keep the module-only behavior.
 */
export function employeeSectionVisible(enabledModules, sectionId, { timeClockEnabled } = {}) {
  if (sectionId === 'timeClock' && timeClockEnabled === false) return false;
  return employeeSectionAllowedByCompanyModules(enabledModules, sectionId);
}

/** Catalog for onboarding UI (selectable; core locked). */
export function listCompanyModuleCatalog() {
  return COMPANY_MODULE_REGISTRY.map((item) => ({ ...item }));
}

/**
 * Intersect user caps with company module allow-list.
 * @param {Set<string>} caps
 * @param {string[]|null|undefined} enabledModules
 * @returns {Set<string>}
 */
export function intersectCapsWithCompanyModules(caps, enabledModules) {
  const allowed = capsForCompanyModules(enabledModules);
  if (!allowed) return caps;
  const next = new Set();
  for (const c of caps) {
    if (c === PROFILE_SELF || allowed.has(c)) next.add(c);
  }
  if (caps.has(USERS_MANAGE)) next.add(USERS_MANAGE);
  if (caps.has(COMPANIES_MANAGE)) next.add(COMPANIES_MANAGE);
  return next;
}
