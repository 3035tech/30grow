import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
import * as mobileMultipart from '../../lib/mobile-multipart.js';

async function moduleAt(path, dependencies) {
  const context = vm.createContext({ URL, Buffer, Response, Request, console, queueMicrotask, setTimeout, clearTimeout });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
  await module.evaluate();
  return module.namespace;
}
const common = {
  z, ERR, HTTP_STATUS, query: async () => ({}),
  NextResponse: class extends Response { static json(body, options) { return { body, ...options }; } },
  apiError: (_request, code, status) => ({ code, status }),
  apiErrorFromResult: (_request, result) => ({ code: result.errorCode, status: 409 }),
  mobileEmployeeBearerToken: () => 'test', checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => '127.0.0.1',
  zPositiveInt: z.coerce.number().int().positive(),
  ISO_DAY_PATTERN: /^\d{4}-\d{2}-\d{2}$/, TIME_REQUEST_RATE_LIMIT: 20, TIME_REQUEST_RATE_WINDOW_MS: 3600000,
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const BASE = '../../app/api/mobile/v1/employee/time-clock';

test('mobile time history: bearer, ISO period and tenant from the session only', async () => {
  for (const companyId of [1, 2]) {
    const calls = [];
    const deps = { ...common, authenticateMobileEmployee: async () => ({ companyId, candidateId: companyId * 10 }), getEmployeeTimeHistory: async (_db, input) => { calls.push(input); return { ok: true, days: [] }; } };
    const route = await moduleAt(`${BASE}/history/route.js`, deps);
    const ok = await route.GET({ url: 'https://example.test/h?from=2026-09-01&to=2026-09-30&companyId=99' });
    assert.equal(ok.body.ok, true); assert.equal(ok.headers['Cache-Control'], 'no-store');
    assert.deepEqual(plain(calls[0]), { companyId, candidateId: companyId * 10, from: '2026-09-01', to: '2026-09-30' });
    assert.equal((await route.GET({ url: 'https://example.test/h?from=01/09/2026' })).code, ERR.INVALID_DATE);
    assert.equal(calls.length, 1);
    deps.authenticateMobileEmployee = async () => null;
    assert.equal((await (await moduleAt(`${BASE}/history/route.js`, deps)).GET({ url: 'https://example.test/h' })).status, 401);
  }
});

test('mobile time requests: create and withdraw reuse the shared web action with the session tenant', async () => {
  for (const companyId of [1, 2]) {
    const session = { companyId, candidateId: companyId * 10 };
    const created = [], withdrawn = [];
    const deps = {
      ...common, authenticateMobileEmployee: async () => session,
      submitEmployeeTimeRequest: async (_req, s, body) => { created.push({ s, body }); return body.kind ? { ok: true, item: { id: 5 } } : { ok: false, errorCode: ERR.INVALID_DATA }; },
      withdrawEmployeeTimeRequest: async (_req, s, id) => { withdrawn.push({ s, id }); return { ok: true, id }; },
    };
    const create = await moduleAt(`${BASE}/requests/route.js`, deps);
    const body = { kind: 'excuse', day: '2026-09-10', justification: 'Consulta', companyId: 99 };
    const res = await create.POST(new Request('https://example.test/r', { method: 'POST', body: JSON.stringify(body) }));
    assert.deepEqual(plain(res.body), { ok: true, item: { id: 5 } });
    assert.deepEqual(plain(created[0].s), session); assert.equal(created[0].body.companyId, 99, 'raw body goes to the shared schema, tenant comes from session');
    assert.equal((await create.POST(new Request('https://example.test/r', { method: 'POST', body: '{}' }))).code, ERR.INVALID_DATA);
    deps.checkRateLimit = async () => ({ ok: false });
    assert.equal((await (await moduleAt(`${BASE}/requests/route.js`, deps)).POST(new Request('https://example.test/r', { method: 'POST', body: '{}' }))).status, 429);

    const cancel = await moduleAt(`${BASE}/requests/[id]/route.js`, deps);
    assert.equal((await cancel.DELETE({}, { params: Promise.resolve({ id: '7' }) })).body.id, 7);
    assert.deepEqual(plain(withdrawn[0]), { s: session, id: 7 });
    assert.equal((await cancel.DELETE({}, { params: Promise.resolve({ id: '../7' }) })).code, ERR.INVALID_ID);
    deps.authenticateMobileEmployee = async () => null;
    assert.equal((await (await moduleAt(`${BASE}/requests/[id]/route.js`, deps)).DELETE({}, { params: Promise.resolve({ id: '7' }) })).status, 401);
  }
});

function uploadRequest({ size = 100, extra = false } = {}) {
  const body = new FormData(); body.append('file', new Blob([new Uint8Array(size)], { type: 'application/pdf' }), 'proof.pdf');
  if (extra) body.append('companyId', '99');
  return new Request('https://example.test/file', { method: 'POST', body });
}

test('mobile time request proof: single bounded file, own request only, safe download headers', async () => {
  for (const companyId of [1, 2]) {
    const session = { companyId, candidateId: companyId * 10 };
    const uploads = [];
    const deps = {
      ...common, ...mobileMultipart, DP_DOC_MAX_BYTES: 5 * 1024 * 1024, authenticateMobileEmployee: async () => session,
      uploadTimeRequestAttachment: async (input) => { uploads.push(input); return { ok: true, id: input.id, hasFile: true }; },
      clearTimeRequestAttachment: async (input) => ({ ok: true, id: input.id, hasFile: false, input }),
      downloadTimeRequestAttachment: async (input) => { assert.deepEqual(plain(input), { companyId, candidateId: companyId * 10, id: 22 }); return { ok: true, body: Buffer.from('pdf'), fileName: 'a\r\n.pdf', contentType: 'application/pdf' }; },
    };
    const route = await moduleAt(`${BASE}/requests/[id]/file/route.js`, deps);
    const props = { params: Promise.resolve({ id: '22' }) };
    const res = await route.POST(uploadRequest(), props);
    assert.equal(res.body.hasFile, true);
    assert.equal(uploads[0].companyId, companyId); assert.equal(uploads[0].candidateId, companyId * 10); assert.equal(uploads[0].id, 22);
    assert.equal((await route.POST(uploadRequest({ extra: true }), props)).status, 400);
    const oversized = new Request('https://example.test/file', { method: 'POST', body: new Uint8Array(6 * 1024 * 1024), headers: { 'Content-Type': 'multipart/form-data; boundary=test' } });
    assert.equal((await route.POST(oversized, props)).code, ERR.INVALID_CV_FILE_SIZE);
    assert.equal(uploads.length, 1);
    const opened = await route.GET({}, props);
    assert.equal(opened.headers.get('cache-control'), 'private, no-store');
    assert.equal(opened.headers.get('content-disposition'), 'attachment; filename="a__.pdf"');
    assert.equal((await route.DELETE({}, props)).body.hasFile, false);
    deps.authenticateMobileEmployee = async () => null;
    const anonymous = await moduleAt(`${BASE}/requests/[id]/file/route.js`, deps);
    assert.equal((await anonymous.POST(uploadRequest(), props)).status, 401);
  }
});
