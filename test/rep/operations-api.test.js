import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CAP, can, canAny, isAdminRole } from '../../lib/identity/permissions.js';
import { ERR } from '../../lib/api-error-codes.js';
import { canManageDigitalCertificate } from '../../lib/rep/certificate-admin.js';
async function moduleAt(path, deps, context) {
  const m = new vm.SourceTextModule(
    await readFile(new URL(path, import.meta.url), 'utf8'),
    { context },
  );
  await m.link(
    (spec) =>
      deps[spec] ||
      new vm.SyntheticModule(
        Object.keys(deps.values),
        function () {
          for (const [k, v] of Object.entries(deps.values))
            this.setExport(k, v);
        },
        { context },
      ),
  );
  await m.evaluate();
  return m;
}
async function fixture(payload) {
  const calls = [];
  const context = vm.createContext({ Response, URL, Date, console });
  const values = {
    z,
    zPositiveInt: z.coerce.number().int().positive(),
    CAP,
    ERR,
    canManageDigitalCertificate,
    NextResponse: { json: (body, init) => Response.json(body, init) },
    apiError: (_r, errorCode, status) =>
      Response.json({ errorCode }, { status }),
    getSessionPayload: async () => payload,
    getManagerScope: (p) => ({
      authorized: !!p,
      isAdmin: isAdminRole(p),
      companyId: p?.companyId,
    }),
    requireCapability: can,
    requireAnyCapability: canAny,
    resolveScopedCompanyId: () => null,
    parseJsonBody: async (req, schema) => {
      const p = schema.safeParse(await req.json());
      return p.success
        ? { ok: true, data: p.data }
        : {
            ok: false,
            response: Response.json(
              { errorCode: ERR.INVALID_DATA },
              { status: 400 },
            ),
          };
    },
    parseSearchParams: () => ({ ok: true, data: {} }),
    timeClockOperations: async () => {
      calls.push('read');
      return { ok: true };
    },
    retryTimePush: async (_db, args) => {
      calls.push(args);
      return { ok: true };
    },
    auditFromRequest: async () => {
      calls.push('audit');
    },
    checkRateLimit: async () => ({ ok: true }),
  };
  const wrapper = await moduleAt('../../lib/admin-api.js', { values }, context);
  const route = await moduleAt(
    '../../app/api/admin/time-clock/operations/route.js',
    { values, '../../../../../lib/admin-api.js': wrapper },
    context,
  );
  return { route: route.namespace, calls };
}
const request = (body) =>
  new Request('https://team.test/api/admin/time-clock/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
test('operations and retries require a platform superadmin, before data access', async () => {
  for (const payload of [
    null,
    { role: 'admin', companyId: 2, userId: 9 },
    { role: 'manager', companyId: 2, userId: 9 },
  ]) {
    const f = await fixture(payload);
    assert.ok((await f.route.GET(request({}))).status >= 400);
    assert.ok((await f.route.POST(request({ id: 1 }))).status >= 400);
    assert.equal(f.calls.length, 0);
  }
});
test('superadmin response is private and retry is validated and audited', async () => {
  const f = await fixture({ role: 'admin', companyId: null, userId: 1 });
  const r = await f.route.GET(request({}));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(
    (await f.route.POST(request({ id: 8, companyId: 2 }))).status,
    400,
  );
  assert.equal((await f.route.POST(request({ id: 8 }))).status, 200);
  assert.equal(f.calls.at(-1), 'audit');
});
test('cron rejects missing authentication and stale clock measurements before processing', async () => {
  const calls = [];
  const context = vm.createContext({ Response, Date });
  const values = {
    z,
    ERR,
    NextResponse: { json: (body, init) => Response.json(body, init) },
    apiError: (_r, errorCode, status) =>
      Response.json({ errorCode }, { status }),
    verifyCronRequest: (r) =>
      r.headers.get('authorization') === 'Bearer fixture',
    processTimePush: async () => {
      calls.push('work');
      return { sent: 0 };
    },
    query: async () => {
      calls.push('clock');
    },
  };
  const route = (
    await moduleAt(
      '../../app/api/cron/time-clock-maintenance/route.js',
      { values },
      context,
    )
  ).namespace;
  const req = (body, authorized = true) =>
    new Request('https://team.test/api/cron/time-clock-maintenance', {
      method: 'POST',
      headers: authorized ? { authorization: 'Bearer fixture' } : {},
      body: JSON.stringify(body),
    });
  assert.equal((await route.POST(req({}, false))).status, 401);
  assert.equal(
    (
      await route.POST(
        req({ clock: { offsetMs: 0, observedAt: '2020-01-01T00:00:00.000Z' } }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await route.POST(
        req({
          clock: { offsetMs: 40000, observedAt: new Date().toISOString() },
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(calls, ['clock', 'work']);
});
