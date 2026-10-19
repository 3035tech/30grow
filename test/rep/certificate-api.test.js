import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  canManageDigitalCertificate,
  certificateAdminSchema,
} from '../../lib/rep/certificate-admin.js';
import { publicCertificateSettings } from '../../lib/rep/certificate-settings.js';
import { CAP, can, canAny, isAdminRole } from '../../lib/permissions.js';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
async function fixture({
  payload = { role: 'admin', companyId: null, userId: 1 },
  limited = false,
  failure = false,
} = {}) {
  const calls = [];
  const settings = {
    bucket: 'private',
    key: 'a1.p12',
    region: 'sa-east-1',
    password: 'never-return-this',
    certificate: { fingerprint: 'a'.repeat(64) },
  };
  const deps = {
    CAP,
    ERR,
    HTTP_STATUS,
    canManageDigitalCertificate,
    certificateAdminSchema,
    publicCertificateSettings,
    runtimeAppUrl: () => 'https://team.test',
    getSessionPayload: async () => payload,
    getManagerScope: (value) => ({
      authorized: !!value,
      isAdmin: isAdminRole(value),
      companyId: value?.companyId,
    }),
    resolveScopedCompanyId: () => null,
    requireCapability: can,
    requireAnyCapability: canAny,
    parseJsonBody: async (request, schema) => {
      const p = schema.safeParse(await request.json());
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
    NextResponse: { json: (body, init) => Response.json(body, init) },
    apiError: (_req, code, status, _values, init) =>
      Response.json({ errorCode: code }, { ...init, status }),
    certificateSecretConfigured: () => true,
    readSigningSettings: async () => {
      calls.push('read');
      return settings;
    },
    validateAndSaveCertificate: async () => {
      calls.push('validate');
      if (failure) throw new Error('AWS private password=secret');
      return publicCertificateSettings(settings);
    },
    auditFromRequest: async (_request, entry) => {
      calls.push(['audit', entry]);
    },
    checkRateLimit: async () => ({ ok: !limited }),
  };
  const context = vm.createContext({
    URL,
    console: { warn() {}, error() {} },
    Response,
  });
  function synthetic() {
    return new vm.SyntheticModule(
      Object.keys(deps),
      function () {
        for (const [k, v] of Object.entries(deps)) this.setExport(k, v);
      },
      { context },
    );
  }
  const wrapper = new vm.SourceTextModule(
    await readFile(new URL('../../lib/admin-api.js', import.meta.url), 'utf8'),
    { context },
  );
  await wrapper.link(() => synthetic());
  await wrapper.evaluate();
  const route = new vm.SourceTextModule(
    await readFile(
      new URL(
        '../../app/api/admin/digital-certificate/route.js',
        import.meta.url,
      ),
      'utf8',
    ),
    { context },
  );
  await route.link((spec) =>
    spec.endsWith('admin-api.js') ? wrapper : synthetic(),
  );
  await route.evaluate();
  return { calls, route: route.namespace };
}
const request = (origin = 'https://team.test') =>
  new Request('https://team.test/api/admin/digital-certificate', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save',
      bucket: 'private',
      key: 'a1.p12',
      region: 'sa-east-1',
      password: 'secret-test',
    }),
  });
test('API rejects missing sessions and tenant users before reading secrets', async () => {
  for (const payload of [
    null,
    { role: 'hr', companyId: 1 },
    { role: 'direction', companyId: 1 },
    { role: 'admin', companyId: 1 },
  ]) {
    const f = await fixture({ payload });
    assert.ok(
      [401, 403].includes(
        (
          await f.route.GET(
            new Request('https://team.test/api/admin/digital-certificate'),
          )
        ).status,
      ),
    );
    assert.ok([401, 403].includes((await f.route.POST(request())).status));
    assert.deepEqual(f.calls, []);
  }
});
test('platform API returns a private allowlisted response and audits without credentials', async () => {
  const f = await fixture();
  const get = await f.route.GET(
    new Request('https://team.test/api/admin/digital-certificate'),
  );
  assert.equal(get.status, 200);
  assert.match(get.headers.get('cache-control'), /no-store/);
  assert.ok(!(await get.text()).includes('never-return-this'));
  const res = await f.route.POST(request());
  assert.equal(res.status, 200);
  assert.ok(!(await res.text()).includes('never-return-this'));
  assert.ok(!JSON.stringify(f.calls).includes('secret-test'));
  assert.equal(f.calls[2][0], 'audit');
});
test('cross-site, rate-limited and failed requests never expose AWS error details', async () => {
  let f = await fixture();
  assert.equal((await f.route.POST(request('https://evil.test'))).status, 403);
  assert.deepEqual(f.calls, []);
  f = await fixture({ limited: true });
  assert.equal((await f.route.POST(request())).status, 429);
  assert.deepEqual(f.calls, []);
  f = await fixture({ failure: true });
  const res = await f.route.POST(request());
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes('password'));
  assert.deepEqual(f.calls, ['validate']);
});
