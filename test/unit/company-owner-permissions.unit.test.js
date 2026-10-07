import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CAP,
  can,
  canAccessDashboardTab,
  canManageCompanyModules,
  isCompanyOwnerPayload,
} from '../../lib/permissions.js';
import { assertUserInScope } from '../../lib/users-admin-scope.js';

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const owner = { role: 'direction', companyId: 7, companyOwner: true, companyModules: null };
const joiner = { role: 'hr', companyId: 7, companyOwner: false, companyModules: null };

describe('company owner permissions', () => {
  it('lets only the company creator manage managers of the tenant', () => {
    assert.equal(can(owner, CAP.USERS_MANAGE), true);
    assert.equal(canAccessDashboardTab(owner, 'users'), true);
    assert.equal(can(joiner, CAP.USERS_MANAGE), false);
    assert.equal(canAccessDashboardTab(joiner, 'users'), false);
  });

  it('keeps platform-only tabs and companies management away from the owner', () => {
    assert.equal(can(owner, CAP.COMPANIES_MANAGE), false);
    for (const tab of ['leads', 'product-feedback', 'companies']) {
      assert.equal(canAccessDashboardTab(owner, tab), false, tab);
    }
  });

  it('keeps users.manage when company modules restrict the tenant', () => {
    assert.equal(can({ ...owner, companyModules: ['core'] }, CAP.USERS_MANAGE), true);
  });

  it('ignores the owner flag without a company', () => {
    assert.equal(isCompanyOwnerPayload({ role: 'direction', companyOwner: true, companyId: null }), false);
  });

  it('keeps users.manage when the owner has customized modules', () => {
    const customized = { ...owner, capabilitiesCustomized: true, capabilityOverrides: [] };
    assert.equal(can(customized, CAP.USERS_MANAGE), true);
    assert.equal(can(customized, CAP.VACANCIES_VIEW), false);
  });

  it('scopes non-admin user management to hr/direction of the same tenant', () => {
    const scope = { isAdmin: false, companyId: 7 };
    assert.equal(assertUserInScope({ companyId: 7, role: 'hr' }, scope), true);
    assert.equal(assertUserInScope({ companyId: 7, role: 'admin' }, scope), false);
    assert.equal(assertUserInScope({ companyId: 8, role: 'hr' }, scope), false);
    assert.equal(assertUserInScope({ companyId: 7, role: 'admin' }, { isAdmin: true, companyId: null }), true);
  });

  it('keeps hr-score recalculation and cache metrics tenant-safe', () => {
    assert.match(
      source('app/api/admin/hr-score/recalculate/route.js'),
      /isAdminRole\(payload\)\s*\?\s*parseInt\(body\.companyId\)\s*:\s*parseInt\(payload\.companyId\)/
    );
    assert.match(source('app/api/admin/hr-score/cache-metrics/route.js'), /isSuperAdminPayload\(payload\)/);
  });

  it('restricts company module editing to the creator or admin', () => {
    assert.equal(canManageCompanyModules(owner), true);
    assert.equal(canManageCompanyModules(joiner), false);
    assert.equal(canManageCompanyModules({ role: 'admin', companyId: null }), true);
  });

  it('enforces the module rule on every write path', () => {
    const me = source('app/api/me/company-modules/route.js');
    assert.match(me, /canEdit: canManageCompanyModules\(ctx\.payload\)/);
    assert.match(me, /!canManageCompanyModules\(ctx\.payload\)[\s\S]*ERR\.FORBIDDEN/);
    assert.match(source('app/api/admin/onboarding/complete/route.js'), /canManageCompanyModules\(payload\)/);
    assert.match(source('lib/session.js'), /signup_creator_user_id = u\.id\) AS "companyOwner"/);
  });
});
