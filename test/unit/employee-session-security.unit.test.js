import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function session({ cookie = 'signed-test-token', payload = { candidateId: 10, companyId: 1, sv: 2 }, live = { sessionVersion: 2, employmentStatus: 'employee' }, dbFailure = false } = {}) {
  const calls = [];
  const deps = {
    cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }),
    EMPLOYEE_COOKIE_NAME: 'team30_employee_session',
    verifyEmployeeToken: () => payload,
    isEmployeeSessionPayload: value => !!value?.candidateId && !!value?.companyId,
    loadEmployeeSessionVersion: async (candidateId, companyId) => {
      calls.push(['live', candidateId, companyId]);
      if (dbFailure) throw new Error('database unavailable');
      return live;
    },
    getCompanyEnabledModules: async (_db, companyId) => { calls.push(['modules', companyId]); return ['dp']; },
    EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' },
  };
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(await readFile(new URL('../../lib/employee/employee-session.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [name, value] of Object.entries(deps)) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  return { calls, resolve: module.namespace.getEmployeeSessionPayload };
}

test('active employee session checks the live tenant row before modules', async () => {
  const f = await session();
  const payload = await f.resolve();
  assert.equal(payload.candidateId, 10);
  assert.deepEqual(f.calls, [['live', 10, 1], ['modules', 1]]);
});

test('revoked, removed and former employee sessions cannot reach protected handlers', async () => {
  for (const live of [null, { sessionVersion: 3, employmentStatus: 'employee' }, { sessionVersion: 2, employmentStatus: 'alumni' }, { sessionVersion: 2, employmentStatus: null }]) {
    const f = await session({ live });
    assert.equal(await f.resolve(), null);
    assert.equal(f.calls.length, 1);
  }
});

test('missing/invalid sessions and missing version never load entitlements', async () => {
  for (const options of [{ cookie: '' }, { payload: null }, { payload: { candidateId: 10, companyId: 1 } }]) {
    const f = await session(options);
    assert.equal(await f.resolve(), null);
    assert.equal(f.calls.length, 0);
  }
});

test('database failures do not restore access based solely on JWT claims', async () => {
  const f = await session({ dbFailure: true });
  await assert.rejects(f.resolve(), /database unavailable/);
  assert.equal(f.calls.length, 1);
});
