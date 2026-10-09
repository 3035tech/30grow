import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
import { LOCALES } from '../../lib/locale-negotiation.js';
const zLocale = z.enum(LOCALES);
const common = {
  employeeSectionVisible: () => false, getEmployeeDpHome: async () => null, getEmployeeTimeClockToday: async () => null, listEmployeeSurveyInbox: async () => null, listFeedbackInbox: async () => null, listEmployeeVisibleCompensation: async () => null, z, zLocale, ERR, HTTP_STATUS, getCompanyEnabledModules: async () => null, getEmployeeProfile: async () => ({ ok: true }), getEmployeeHome: async () => ({ ok: true }), t: () => "Task", normalizeLocale: (v) => v, getTimeClockAccess: async () => ({ ok: true }),
  NextResponse: { json: (body, options) => ({ body, ...options }) },
  apiError: (_request, code, status, _values, init) => ({ code, status, ...init }),
  apiErrorFromResult: (_request, result, options) => ({ code: result.errorCode, status: 400, ...options?.init }),
  query: null, clientIpFromRequest: () => 'ip', checkRateLimit: async () => ({ ok: true }),
  mobileEmployeeBearerToken: () => 'bearer',
  authenticateMobileEmployee: async () => ({ companyId: 2, candidateId: 20 }),
  parseJsonBody: async (req, schema) => { const input = schema.safeParse(await req.json()); return input.success ? { ok: true, data: input.data } : { ok: false, response: { status: 400, headers: new Headers() } }; },
};
async function load(path, deps) {
  const context = vm.createContext({ console, URL });
  const mod = new vm.SourceTextModule(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'), { context });
  await mod.link(async () => new vm.SyntheticModule(Object.keys(deps), function () { for (const [k, v] of Object.entries(deps)) this.setExport(k, v); }, { context }));
  await mod.evaluate(); return mod.namespace;
}
const req = (body) => ({ json: async () => body });
test('locale patch persists supported locale only with authenticated ownership', async () => {
  const calls = [];
  const deps = { ...common, getEmployeeProfile: async () => ({}), updateEmployeeProfile: async (_db, scope) => { calls.push(scope); return { ok: true }; } };
  const route = await load('app/api/mobile/v1/employee/profile/route.js', deps);
  assert.equal((await route.PATCH(req({ preferredLocale: 'fr-FR', companyId: 99, candidateId: 99 }))).body.ok, true);
  assert.equal(calls[0].companyId, 2); assert.equal(calls[0].candidateId, 20); assert.equal(calls[0].patch.preferredLocale, 'fr-FR');
  for (const invalid of [{ preferredLocale: 'bad' }, null, [], 'invalid']) {
    const result = await route.PATCH(req(invalid));
    assert.equal(result.status, 400);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  } assert.equal(calls.length, 1);
  deps.authenticateMobileEmployee = async () => null;
  assert.equal((await (await load('app/api/mobile/v1/employee/profile/route.js', deps)).PATCH(req({ preferredLocale: 'en' }))).status, 401);
});
test('welcome dismissal rejects injected scope and unknown actions before writes', async () => {
  const calls = [];
  const deps = { ...common, dismissEmployeeWelcome: async (_db, scope) => { calls.push(scope); return { ok: true }; } };
  const route = await load('app/api/mobile/v1/employee/home/route.js', deps);
  for (const body of [{ action: 'dismissWelcome', companyId: 99 }, { action: 'unknown' }, null]) assert.equal((await route.POST(req(body))).status, 400);
  assert.equal(calls.length, 0);
  for (let i = 0; i < 2; i++) assert.equal((await route.POST(req({ action: 'dismissWelcome' }))).body.showWelcome, false);
  assert.equal(calls[0].companyId, 2); assert.equal(calls[0].candidateId, 20);
  deps.checkRateLimit = async () => ({ ok: false });
  assert.equal((await (await load('app/api/mobile/v1/employee/home/route.js', deps)).POST(req({ action: 'dismissWelcome' }))).status, 429);
});
test('magic exchange requires 2FA and grants only the token-owned company, not injected contexts', async () => {
  let consumed = 0, issued = 0, needs2fa = true, valid = true;
  const deps = { ...common,
    MOBILE_EMPLOYEE_AUTH_OUTCOME: { REQUIRES_SECOND_FACTOR: 'requires_second_factor' },
    consumeEmployeeMagicToken: async () => { consumed++; return valid ? { ok: true, companyId: 2, candidateId: 20 } : { ok: false }; },
    employee2faRequired: async (cid, co) => { assert.equal(cid, 20); assert.equal(co, 2); return needs2fa; },
    signMobileEmployeeSecondFactor: async (_result, contexts) => { assert.equal(contexts.length, 1); assert.equal(contexts[0].companyId, 2); return 'challenge'; },
    completeMobileEmployeeAuthentication: async (_result, contexts) => { issued++; assert.equal(contexts.length, 1); assert.equal(contexts[0].candidateId, 20); return { ok: true }; },
  };
  const route = await load('app/api/mobile/v1/auth/magic-link/exchange/route.js', deps);
  assert.equal((await route.POST(req({ token: 'x'.repeat(32), companyId: 99 }))).status, 400); assert.equal(consumed, 0);
  assert.equal((await route.POST(req({ token: 'x'.repeat(32) }))).body.outcome, 'requires_second_factor'); assert.equal(issued, 0);
  needs2fa = false; assert.equal((await route.POST(req({ token: 'x'.repeat(32) }))).body.ok, true); assert.equal(issued, 1);
  valid = false; assert.equal((await route.POST(req({ token: 'x'.repeat(32) }))).status, 401); assert.equal(issued, 1);
});
test('magic request has uniform success, CAPTCHA, account limits and bounded strict input', async () => {
  let sent = 0, captcha = true;
  const deps = { ...common, accountRateLimitKey: () => 'account', verifyTurnstileToken: async () => ({ ok: captcha }), requestEmployeeMagicLink: async (_db, input) => { sent++; assert.equal(input.requireMail, true); assert.equal(input.mobile, true); return { ok: true, sent: false, ambiguous: true }; } };
  const route = await load('app/api/mobile/v1/auth/magic-link/route.js', deps);
  const result = await route.POST(req({ email: 'person@example.com', locale: 'en' }));
  assert.equal(result.body?.ok, true, JSON.stringify(result));
  assert.equal(result.headers['Cache-Control'], 'no-store');
  const invalid = await route.POST(req({ email: 'person@example.com', companyId: 99 }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
  captcha = false; assert.equal((await route.POST(req({ email: 'person@example.com' }))).status, 400); assert.equal(sent, 1);
  captcha = true;
  let limits = 0;
  deps.checkRateLimit = async () => (++limits === 1 ? { ok: true } : { ok: false, retryAfterSec: 42 });
  const limited = await (await load('app/api/mobile/v1/auth/magic-link/route.js', deps)).POST(req({ email: 'person@example.com' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '42');
  assert.equal(limited.headers['Cache-Control'], 'no-store');
  assert.equal(sent, 1);
});
test('login and refresh return the persisted locale, with a default for legacy profiles', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const crypto = await import('node:crypto');
  const { normalizeLocale } = await import('../../lib/locale-negotiation.js');
  let preferredLocale = 'fr-FR';
  const row = () => ({ candidateId: 20, companyId: 2, companyName: 'Company', sessionVersion: 1, preferredLocale, displayName: 'Person' });
  const query = async (sql) => sql.includes('FROM candidates') ? { rows: [row()], rowCount: 1 } : { rows: [], rowCount: 1 };
  const deps = { ...common, default: jwt, createHash: crypto.createHash, randomBytes: crypto.randomBytes, randomUUID: crypto.randomUUID,
    // crypto and jwt both use default imports, so link them individually below.
    normalizeLocale, getJwtSecret: () => 'test-secret-at-least-thirty-two-characters', query,
    EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' }, verifyEmployeeCompanyPickChallenge: () => null,
    loadEmployeeSessionVersion: async () => ({}), issueSecondFactorChallenge: async () => ({}), secondFactorChallengeLive: async () => true,
    withTransaction: async (fn) => fn({ query: async (sql) => {
      if (sql.includes('FROM mobile_employee_refresh_sessions')) return { rowCount: 1, rows: [{ id: 1, familyId: 'family', candidateId: 20, companyId: 2, expiresAt: new Date(Date.now() + 60000).toISOString(), allowedContexts: [{ candidateId: 20, companyId: 2, sessionVersion: 1 }] }] };
      if (sql.includes('FROM candidates')) return { rowCount: 1, rows: [row()] };
      return { rowCount: 1, rows: [{ id: 2 }] };
    } }),
  };
  const context = vm.createContext({ console, Buffer, Date });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../lib/mobile-employee-session.js', import.meta.url), 'utf8'), { context });
  await mod.link(async (specifier) => {
    const exports = specifier === 'node:crypto' ? { default: crypto } : deps;
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
  });
  await mod.evaluate();
  const contexts = [{ candidateId: 20, companyId: 2 }];
  assert.equal((await mod.namespace.completeMobileEmployeeAuthentication(contexts[0], contexts)).session.identity.locale, 'fr-FR');
  preferredLocale = 'de-DE';
  assert.equal((await mod.namespace.refreshMobileEmployeeSession('opaque-refresh')).session.identity.locale, 'de-DE');
  preferredLocale = null;
  assert.equal((await mod.namespace.completeMobileEmployeeAuthentication(contexts[0], contexts)).session.identity.locale, 'pt-BR');
});

test('home preserves domain errors and disables caching on failures', async () => {
  const deps = { ...common,
    getEmployeeProfile: async () => ({ ok: true, person: { preferredLocale: 'en' } }),
    getEmployeeHome: async () => ({ ok: false, errorCode: 'SCHEMA_NOT_INITIALIZED' }),
    dismissEmployeeWelcome: async () => ({ ok: false, errorCode: 'NOT_FOUND' }),
  };
  const route = await load('app/api/mobile/v1/employee/home/route.js', deps);
  const failure = await route.GET({ url: 'https://example.com/home' });
  assert.equal(failure.code, 'SCHEMA_NOT_INITIALIZED');
  assert.equal(failure.headers['Cache-Control'], 'no-store');
  const dismissed = await route.POST(req({ action: 'dismissWelcome' }));
  assert.equal(dismissed.code, 'NOT_FOUND');
  assert.equal(dismissed.headers['Cache-Control'], 'no-store');
  deps.getEmployeeProfile = async () => { throw new Error('database unavailable'); };
  const unavailable = await (await load('app/api/mobile/v1/employee/home/route.js', deps)).GET({ url: 'https://example.com/home' });
  assert.equal(unavailable.status, 500);
  assert.equal(unavailable.headers['Cache-Control'], 'no-store');
});
