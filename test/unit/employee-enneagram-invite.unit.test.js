import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ERR } from '../../lib/api-error-codes.js';
import { buildEmployeeEnneagramInviteMail } from '../../lib/assessment/employee-enneagram-invite-mail.js';

test('employee Enneagram email includes a tappable link without rendering profile text as HTML', () => {
  const mail = buildEmployeeEnneagramInviteMail({
    fullName: 'Ana <script>', companyName: 'Empresa & Co',
    assessmentUrl: 'https://grow.example/t/team-token', locale: 'pt-BR',
  });
  assert.match(mail.text, /https:\/\/grow\.example\/t\/team-token/);
  assert.match(mail.html, /href="https:\/\/grow\.example\/t\/team-token"/);
  assert.match(mail.html, /Empresa &amp; Co/);
  assert.doesNotMatch(mail.html, /<script>/);
});

test('employee Enneagram invite uses the existing team link and stays scoped to the employee', async () => {
  const sent = [];
  const queries = [];
  let answered = false;
  let mailConfigured = true;
  let options;
  const optional = { optional: () => ({}) };
  const deps = {
    NextResponse: { json: Response.json },
    withAdminApi: (opts, handler) => { options = opts; return handler; },
    CAP: { TEAM_VIEW: 'team.view' },
    publicAppUrl: () => 'https://grow.example',
    apiError: (_request, errorCode, status) => Response.json({ errorCode }, { status }),
    ERR,
    z: { object: () => ({}) }, zLocale: optional, zPositiveInt: optional,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FROM candidates c JOIN companies')) {
        return { rowCount: params[1] === 9 ? 1 : 0, rows: [{ id: 27, companyId: 9, fullName: 'Ana Silva', email: 'ana@example.com', employmentStatus: 'employee', companyName: 'Empresa' }] };
      }
      return { rowCount: answered ? 1 : 0, rows: answered ? [{}] : [] };
    },
    EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' },
    isValidEmployeeEmail: () => true,
    ensureActiveCompanyLink: async () => 'team-token',
    buildEmployeeEnneagramInviteMail,
    enqueueTransactionalMail: mail => sent.push(mail),
    isMailConfigured: () => mailConfigured,
    checkRateLimit: async () => ({ ok: true }),
    audit: async () => {},
  };
  const context = vm.createContext({ console });
  const routeModule = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/candidates/[id]/enneagram-invite/route.js', import.meta.url), 'utf8'), { context });
  await routeModule.link(async () => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
  }, { context }));
  await routeModule.evaluate();
  assert.equal(options.cap, 'team.view');

  const post = (companyId = 9) => routeModule.namespace.POST({
    request: new Request('https://grow.example/api/admin/candidates/27/enneagram-invite'),
    payload: { userId: 4 }, scope: { isAdmin: false, companyId: 9 },
    body: { companyId, locale: 'pt-BR' }, params: { id: '27' },
  });

  assert.equal((await post(10)).status, 403);
  assert.equal(sent.length, 0);
  mailConfigured = false;
  assert.equal((await post()).status, 503);
  assert.equal(sent.length, 0);
  mailConfigured = true;
  answered = true;
  assert.equal((await post()).status, 409);
  assert.equal(sent.length, 0);
  answered = false;
  const response = await post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sentTo, 'ana@example.com');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@example.com');
  assert.match(sent[0].text, /https:\/\/grow\.example\/t\/team-token/);
  assert.ok(queries.some(({ sql, params }) => sql.includes('FROM candidates c JOIN companies') && params[1] === 9));
});
