/**
 * Offline unit: resolveCohortCompanyId — tenant-bound admin must not see all companies.
 */
import assert from 'node:assert/strict';
import { resolveCohortCompanyId, assessmentListWhereParts } from '../../lib/assessment/assessment-filters.js';

function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('== resolveCohortCompanyId ==');

check('hr always uses home company', () => {
  assert.equal(resolveCohortCompanyId({ isAdmin: false, companyId: 7, scopeCompanyFilter: null }), 7);
  assert.equal(resolveCohortCompanyId({ isAdmin: false, companyId: 7, scopeCompanyFilter: 99 }), 7);
});

check('tenant-bound admin ignores company=all and other chips', () => {
  assert.equal(resolveCohortCompanyId({ isAdmin: true, companyId: 12, scopeCompanyFilter: null }), 12);
  assert.equal(resolveCohortCompanyId({ isAdmin: true, companyId: 12, scopeCompanyFilter: 99 }), 12);
});

check('super-admin unscoped when no chip', () => {
  assert.equal(resolveCohortCompanyId({ isAdmin: true, companyId: null, scopeCompanyFilter: null }), null);
});

check('super-admin respects chip', () => {
  assert.equal(resolveCohortCompanyId({ isAdmin: true, companyId: null, scopeCompanyFilter: 5 }), 5);
});

check('assessmentListWhereParts adds company for tenant-bound admin', () => {
  const { whereParts, params } = assessmentListWhereParts({
    isAdmin: true,
    companyId: 42,
    scopeCompanyFilter: null,
    selectedArea: 'all',
    selectedVacancy: 'all',
  });
  assert.ok(whereParts.some((p) => p.includes('ass.company_id')));
  assert.equal(params[0], 42);
});

check('assessmentListWhereParts leaves super-admin unscoped', () => {
  const { whereParts, params } = assessmentListWhereParts({
    isAdmin: true,
    companyId: null,
    scopeCompanyFilter: null,
    selectedArea: 'all',
    selectedVacancy: 'all',
  });
  assert.ok(!whereParts.some((p) => p.includes('ass.company_id')));
  assert.equal(params.length, 0);
});

if (process.exitCode) {
  console.error('cohort-company-scope: FAILED');
  process.exit(1);
}
console.log('cohort-company-scope: ALL PASSED');
