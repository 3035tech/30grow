import { supportsExpandedKudoReactions } from '../../lib/kudo-reaction-options.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { mobileCommunityBody } from '../../lib/mobile-employee-payload.js';

async function setup(session) {
  const calls = [];
  const dependencies = {
    NextResponse: { json: (body, options) => ({ body, ...options }) }, z,
    apiError: (_request, code, status) => ({ code, status }), apiErrorFromResult: (_request, result) => result,
    HTTP_STATUS: { UNAUTHORIZED: 401, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 }, ERR: { UNAUTHORIZED: 'UNAUTHORIZED', INVALID_DATA: 'INVALID_DATA', INTERNAL: 'INTERNAL' },
    authenticateMobileEmployee: async () => session, mobileEmployeeBearerToken: () => 'test',
    mobileCommunityBody, supportsExpandedKudoReactions,
    listCompanyPosts: async (_db, options) => { calls.push(options); return { ok: true, posts: [{ id: '12', title: 'Mural', bodyHtml: '<p>Aviso</p>', authorName: 'RH', createdAt: '2026-09-28T12:00:00.000Z' }], total: 21 }; },
    listCompanyKudos: async (_db, options) => { calls.push(options); return { ok: true, kudos: [], total: 31 }; },
    searchEmployeeColleagues: async (_db, options) => { calls.push(options); return { ok: true, people: [] }; },
    createCompanyKudo: async () => ({ ok: true, kudo: { id: 1, toCandidateId: 2 } }),
    EMPLOYEE_NOTIF: { KUDOS_RECEIVED: 'kudos' }, notifyCandidate: async () => {},
    mobileIdempotencyKey: () => 'test', checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'test',
  };
  const context = vm.createContext({ URL, console });
  const module = new vm.SourceTextModule(await readFile(new URL('../../app/api/mobile/v1/employee/community/route.js', import.meta.url), 'utf8'), { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
  await module.evaluate();
  return { route: module.namespace, calls };
}

test('GET defaults to page one and POST remains compatible with old consumers', async () => {
  const { route, calls } = await setup({ companyId: 1, candidateId: 10 });
  const result = await route.GET(new Request('https://example.com/community'));
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.pagination.posts.page, 1);
  assert.equal(result.body.posts[0].id, 12);
  assert.equal(result.body.pagination.posts.totalPages, 3);
  assert.equal(calls[0].page, 1);
  const sent = await route.POST(new Request('https://example.com/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toCandidateId: 2, message: 'Obrigado' }) }));
  assert.equal(sent.body.pagination.posts.page, 1);
  assert.equal(sent.body.pagination.kudos.page, 1);
});

test('independent pages and fixed sizes are scoped to each authenticated tenant', async () => {
  for (const companyId of [1, 2]) {
    const { route, calls } = await setup({ companyId, candidateId: companyId * 10 });
    const result = await route.GET(new Request('https://example.com/community?postsPage=2&kudosPage=3'));
    assert.equal(result.body.pagination.posts.page, 2);
    assert.equal(result.body.pagination.kudos.page, 3);
    assert.deepEqual(calls.map((item) => item.companyId), [companyId, companyId, companyId]);
    assert.equal(calls[0].pageSize, 10);
    assert.equal(calls[1].pageSize, 15);
    assert.equal(calls[2].excludeCandidateId, companyId * 10);
  }
});

test('rejects anonymous access and invalid, excessive, duplicate or injected parameters before queries', async () => {
  const anonymous = await setup(null);
  assert.equal((await anonymous.route.GET({})).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const { route, calls } = await setup({ companyId: 1, candidateId: 10 });
  for (const query of ['postsPage=0', 'postsPage=-1', 'postsPage=1.5', 'postsPage=10001', 'postsPage=', 'postsPage=1&postsPage=2', 'companyId=2', 'pageSize=100000']) {
    assert.equal((await route.GET(new Request(`https://example.com/community?${query}`))).status, 400, query);
  }
  assert.equal(calls.length, 0);
});

test('catalog opt-in is additive and never changes tenant or page scope', async () => {
  const { route, calls } = await setup({ companyId: 1, candidateId: 10 });
  const result = await route.GET(new Request('https://example.com/community', { headers: { 'X-Kudo-Reaction-Catalog': '2' } }));
  assert.equal(result.body.reactionCatalogVersion,2);
  assert.deepEqual(calls.map(item=>item.companyId),[1,1,1]);
});
