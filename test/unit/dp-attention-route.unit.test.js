import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ERR } from '../../lib/api-error-codes.js';

test('DP attention identifies failed sources, distinguishes schema and never fabricates success', async () => {
  const logs = []; let failed = null, code = null, options;
  const load = part => async (_db, scope) => {
    assert.equal(scope.companyId, 42);
    if (failed === part) throw Object.assign(new Error('sensitive database text'), { code });
    if (part === 'documents-and-leave') return { pendingDocs: [{ candidateId: 1 }], leaves: [{ status: 'requested' }] };
    if (part === 'absenteeism') return { items: [], lookbackDays: 90 };
    return 3;
  };
  const deps = { ERR, CAP: { DP_VIEW: 'dp.view', TEAM_VIEW: 'team.view' }, DP_LEAVE_STATUS: { REQUESTED: 'requested' }, query: () => {},
    withAdminApi: (opts, handler) => { options = opts; return handler; }, NextResponse: { json: Response.json },
    apiError: (_request, errorCode, status, _values, init) => Response.json({ errorCode }, { status, ...init }),
    getDpAttentionPulse: load('documents-and-leave'), getAbsenteeismPulse: load('absenteeism'),
    countPendingTimeRequests: load('time-requests'), countPendingFieldExpenses: load('field-expenses'),
  };
  const context = vm.createContext({ console: { error: (...args) => logs.push(args) } });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/dp/attention/route.js', import.meta.url), 'utf8'), { context });
  await mod.link(async () => new vm.SyntheticModule(Object.keys(deps), function () { for (const [key, value] of Object.entries(deps)) this.setExport(key, value); }, { context }));
  await mod.evaluate();
  assert.equal(options.requireCompany, true);
  assert.deepEqual(Array.from(options.anyCap), ['dp.view', 'team.view']);
  const get = () => mod.namespace.GET({ companyId: 42, request: new Request('https://example.test/api/admin/dp/attention') });
  const success = await get(); assert.equal(success.status, 200);
  assert.equal((await success.json()).pendingTimeRequests, 3);
  for (const part of ['documents-and-leave', 'absenteeism', 'time-requests', 'field-expenses']) {
    failed = part;
    for (const sqlCode of ['42P01', '42703', '08006']) {
      code = sqlCode;
      const response = await get();
      assert.equal(response.status, sqlCode === '08006' ? 500 : 503);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const body = await response.json();
      assert.equal(body.errorCode, sqlCode === '08006' ? ERR.INTERNAL : ERR.SCHEMA_NOT_INITIALIZED);
      assert.equal(body.pendingTimeRequests, undefined);
      assert.equal(logs.at(-1)[1].part, part);
    }
  }
  assert.equal(JSON.stringify(logs).includes('sensitive database text'), false);
});
