import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COHORT_TABS,
  COMPANY_SCOPE_TABS,
  canSwitchTabClientOnly,
  companyInList,
  needsAdminCompaniesList,
  resolveStickyCompanyPreference,
  writeStickyCompanyId,
  readStickyCompanyId,
  DASHBOARD_COMPANY_STORAGE_KEY,
} from '../../lib/dashboard-company-scope.js';

test('COHORT_TABS and COMPANY_SCOPE_TABS stay disjoint where expected', () => {
  for (const tab of COMPANY_SCOPE_TABS) {
    assert.equal(COHORT_TABS.has(tab), false, `${tab} should not be cohort`);
  }
  assert.ok(COMPANY_SCOPE_TABS.has('succession'));
  assert.ok(COMPANY_SCOPE_TABS.has('lms'));
  assert.ok(COMPANY_SCOPE_TABS.has('analytics'));
  assert.ok(needsAdminCompaniesList('audit'));
  assert.ok(needsAdminCompaniesList('succession'));
  assert.ok(needsAdminCompaniesList('overview'));
  assert.equal(needsAdminCompaniesList('users'), false);
});

test('companyInList matches numeric ids', () => {
  const companies = [{ id: 1, name: 'A' }, { id: 42, name: 'B' }];
  assert.equal(companyInList(companies, 42), true);
  assert.equal(companyInList(companies, '42'), true);
  assert.equal(companyInList(companies, 7), false);
  assert.equal(companyInList(companies, 'all'), false);
});

test('resolveStickyCompanyPreference prefers URL then sticky', () => {
  const companies = [{ id: 10, name: 'X' }, { id: 20, name: 'Y' }];
  const store = new Map();
  const prevWindow = globalThis.window;
  globalThis.window = globalThis;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    writeStickyCompanyId(20);
    assert.equal(readStickyCompanyId(), 20);
    assert.equal(
      resolveStickyCompanyPreference({ urlCompany: '10', companies }),
      '10'
    );
    assert.equal(
      resolveStickyCompanyPreference({ urlCompany: 'all', companies }),
      '20'
    );
    writeStickyCompanyId(null);
    assert.equal(readStickyCompanyId(), null);
    assert.equal(store.has(DASHBOARD_COMPANY_STORAGE_KEY), false);
    assert.equal(
      resolveStickyCompanyPreference({ urlCompany: 'all', companies }),
      null
    );
    assert.equal(
      resolveStickyCompanyPreference({
        urlCompany: 'all',
        companies: [{ id: 99, name: 'Only' }],
      }),
      '99'
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

test('B-2804.6: menu switch skips SSR only for self-fetching tabs', () => {
  for (const tab of COHORT_TABS) {
    assert.equal(canSwitchTabClientOnly(tab, { isAdmin: false }), false, `${tab} needs SSR data`);
    assert.equal(canSwitchTabClientOnly(tab, { isAdmin: true, companiesLoaded: true }), false);
  }
  for (const tab of ['vacancies', 'users', 'lms', 'okr', 'climate', 'pdi', 'help', 'profile']) {
    assert.equal(canSwitchTabClientOnly(tab, { isAdmin: false }), true, `${tab} for managers`);
  }
  // Admin: tabs that read the companies list only once it is in memory.
  assert.equal(canSwitchTabClientOnly('climate', { isAdmin: true, companiesLoaded: false }), false);
  assert.equal(canSwitchTabClientOnly('okr', { isAdmin: true, companiesLoaded: false }), false);
  assert.equal(canSwitchTabClientOnly('okr', { isAdmin: true, companiesLoaded: true }), true);
  assert.equal(canSwitchTabClientOnly('users', { isAdmin: true, companiesLoaded: false }), true);
  assert.equal(canSwitchTabClientOnly('', { isAdmin: false }), false);
});

