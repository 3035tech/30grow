import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as permissions from '../../lib/permissions.js';
const context = vm.createContext({});
const source = await readFile(new URL('../../lib/ae/require-admin.js', import.meta.url), 'utf8');
const dependencies = {
  ...permissions,
  runtimeAppUrl: () => '',
  cookies: async () => {},
  verifyToken: () => null,
  COOKIE_NAME: 'session',
  attachCapabilityOverrides: async p => p,
  verifySessionWithCapabilities: async () => null
};
const module = new vm.SourceTextModule(source, {
  context
});
await module.link(() => new vm.SyntheticModule(Object.keys(dependencies), function () {
  for (const [key, value] of Object.entries(dependencies)) this.setExport(key, value);
}, {
  context
}));
await module.evaluate();
const {
  getManagerScope,
  resolveScopedCompanyId,
  requireAdminRole
} = module.namespace;
const {
  CAP,
  can,
  isAdminRole
} = permissions;
for (const role of ['hr', 'direction', 'admin']) test(`${role}: tenant cannot replace session company`, () => {
  const payload = {
      role,
      companyId: 7
    },
    scope = getManagerScope(payload);
  assert.equal(scope.authorized, true);
  assert.equal(scope.isAdmin, false);
  for (const forged of [undefined, 'all', 8, '8', null]) assert.equal(resolveScopedCompanyId(scope, forged), 7);
  assert.equal(requireAdminRole(payload), false);
  assert.equal(can(payload, CAP.COMPANIES_MANAGE), false);
  assert.equal(can(payload, CAP.MOTIVATORS_CONFIG), false);
  assert.equal(can(payload, CAP.TEAM_VIEW), true);
});
test('only platform admin is global; tenant admin role classification remains intact', () => {
  const payload = {
      role: 'admin',
      companyId: null
    },
    scope = getManagerScope(payload);
  assert.equal(scope.authorized, true);
  assert.equal(scope.isAdmin, true);
  assert.equal(resolveScopedCompanyId(scope, 8), 8);
  assert.equal(requireAdminRole(payload), true);
  assert.equal(can(payload, CAP.COMPANIES_MANAGE), true);
  assert.equal(can(payload, CAP.MOTIVATORS_CONFIG), true);
  assert.equal(isAdminRole({
    role: 'admin',
    companyId: 7
  }), true);
});
test('a forged company without a manager role is never an authorized scope', () => {
  for (const payload of [null, {
    role: 'employee',
    companyId: 7
  }, {
    role: 'candidate',
    companyId: 7
  }, {
    role: 'hr',
    companyId: null
  }]) {
    const scope = getManagerScope(payload);
    assert.equal(scope.authorized, false);
    assert.equal(resolveScopedCompanyId(scope, 8), null);
  }
});
test('owner manages own users without platform capabilities; restricted manager stays restricted', () => {
  const owner = {
    role: 'direction',
    companyId: 7,
    companyOwner: true
  };
  assert.equal(can(owner, CAP.USERS_MANAGE), true);
  assert.equal(can(owner, CAP.COMPANIES_MANAGE), false);
  const restricted = {
    role: 'hr',
    companyId: 7,
    capabilitiesCustomized: true,
    capabilityOverrides: [{
      capability: CAP.PROFILE_SELF,
      granted: true
    }]
  };
  assert.equal(can(restricted, CAP.PROFILE_SELF), true);
  assert.equal(can(restricted, CAP.TEAM_VIEW), false);
});
