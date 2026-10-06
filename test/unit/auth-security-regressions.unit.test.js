import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ERR } from '../../lib/api-error-codes.js';

async function load(path, deps) {
  const context = vm.createContext({ console, process, Date, Number, Set, Map });
  const module = new vm.SourceTextModule(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const values = { ...deps, default: specifier === 'jsonwebtoken' ? jwt : crypto };
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

function challengeDb() {
  const pending = new Map();
  let sv = 2;
  const query = async (sql, args) => {
    if (/SELECT session_version/.test(sql)) return { rows: [{ sv }], rowCount: 1 };
    if (/INSERT INTO second_factor/.test(sql)) {
      pending.set(args[0], { sv: args[5], userId: args[2], candidateId: args[3], companyId: args[4], expires: Date.now() + 300000 });
      return { rows: [], rowCount: 1 };
    }
    if (/DELETE FROM second_factor.*expires_at <=/.test(sql)) return { rows: [], rowCount: 0 };
    const row = pending.get(args[0]);
    const valid = row && row.sv === args[1] && row.expires > Date.now();
    if (/SELECT id FROM second_factor/.test(sql)) return { rows: valid ? [{ id: args[0] }] : [], rowCount: valid ? 1 : 0 };
    if (/DELETE FROM second_factor/.test(sql)) {
      const match = valid && row.userId === args[2] && row.candidateId === args[3] && row.companyId === args[4];
      if (match) pending.delete(args[0]);
      return { rows: match ? [{ id: args[0] }] : [], rowCount: match ? 1 : 0 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query, withTransaction: work => work({ query }), revoke: () => { sv++; }, expire: id => { pending.get(id).expires = 0; } };
}

const secret = 'regression-test-secret-at-least-32-characters';
for (const [purpose, identity] of [['manager', { userId: 7 }], ['employee', { candidateId: 8, companyId: 9 }], ['mobile_employee', { candidateId: 8, companyId: 9 }]]) {
  test(`${purpose}: challenge binds version, rejects revocation and consumes only once`, async () => {
    const db = challengeDb();
    const api = await load('lib/second-factor-challenge.js', { ...db, default: crypto, getJwtSecret: () => secret });
    const binding = await api.issueSecondFactorChallenge(purpose, identity);
    const claims = { ...identity, ...binding };
    const token = jwt.sign(claims, secret, { expiresIn: 300 });
    assert.equal(await api.secondFactorChallengeLive(claims), true);
    const results = await Promise.all([api.consumeSecondFactorChallenge(token), api.consumeSecondFactorChallenge(token)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(results.find(Boolean), 2);
    assert.equal(await api.secondFactorChallengeLive(claims), false);
    assert.equal(await api.consumeSecondFactorChallenge(token), false);
    const next = await api.issueSecondFactorChallenge(purpose, identity);
    const oldToken = jwt.sign({ ...identity, ...next }, secret);
    db.revoke();
    assert.equal(await api.secondFactorChallengeLive({ ...identity, ...next }), false);
    assert.equal(await api.consumeSecondFactorChallenge(oldToken), false);
  });
}

test('missing, expired, foreign and invalidly signed challenges cannot be consumed', async () => {
  const db = challengeDb();
  const api = await load('lib/second-factor-challenge.js', { ...db, getJwtSecret: () => secret });
  const identity = { candidateId: 8, companyId: 9 };
  const binding = await api.issueSecondFactorChallenge('employee', identity);
  assert.equal(await api.secondFactorChallengeLive(identity), false);
  assert.equal(await api.consumeSecondFactorChallenge(jwt.sign({ ...identity, ...binding }, 'wrong-key')), false);
  assert.equal(await api.consumeSecondFactorChallenge(jwt.sign({ ...identity, ...binding, companyId: 10 }, secret)), false);
  db.expire(binding.jti);
  assert.equal(await api.consumeSecondFactorChallenge(jwt.sign({ ...identity, ...binding }, secret)), false);
});

async function usersFixture({ totp = false } = {}) {
  const writes = [];
  let storedEmail = 'owner@example.com';
  const row = { id: 7, email: storedEmail, role: 'hr', active: true, companyId: 9, passwordHash: 'hash', totpEnabledAt: totp ? 'now' : null, totpSecret: totp ? 'secret' : null };
  const query = async (sql, args) => {
    if (/UPDATE users/.test(sql)) { writes.push(args); storedEmail = args[1]; return { rows: [{ ...row, email: storedEmail }], rowCount: 1 }; }
    if (/FROM companies/.test(sql)) return { rows: [{ id: 9 }], rowCount: 1 };
    if (/FROM users/.test(sql)) return { rows: [{ ...row, email: storedEmail }], rowCount: 1 };
    throw new Error(sql);
  };
  const api = await load('lib/users-admin.js', {
    query, withTransaction: fn => fn({ query }), verifyPassword: async password => password === 'correct', verifyTotpCode: (_secret, code) => code === '123456',
    checkRateLimit: async () => ({ ok: true }), hashPassword: async () => 'hash',
    PAGE_SIZE_OPTIONS: [20], sqlUsersOrderBy: () => '', ERR,
    ASSIGNABLE_MODULE_CAPS: [], defaultAssignableModulesForRole: () => [], ROLES: ['admin', 'hr', 'direction'],
    assertUserInScope: () => true, loadUserCapabilityOverrides: async () => [], replaceUserModuleCapabilities: async () => ({}),
    bumpSessionVersion: async () => 3, audit: async () => {}, isMailConfigured: () => false,
    hashUnusablePassword: async () => '', issuePasswordSetupInvite: async () => ({}), resolveUserOrigin: () => '',
    USER_AUDIT_VALUE_FIELDS: [], diffAuditFields: () => [], deactivateUserMemberships: async () => {}, syncLegacyUserMembership: async () => {},
  });
  return { writes, update: (body, isAdmin = false, actorUserId = 7) => api.updateUser({ userId: 7, body, actorUserId, isAdmin, scopeCompanyId: 9 }) };
}

test('tenant owner and admin self email edits require current password before any write', async () => {
  for (const admin of [false, true]) {
    const f = await usersFixture();
    assert.equal((await f.update({ email: 'attacker@example.com' }, admin)).errorCode, ERR.EMAIL_CHANGE_PASSWORD_REQUIRED);
    assert.equal((await f.update({ email: 'attacker@example.com', currentPassword: 'wrong' }, admin)).errorCode, ERR.INVALID_CURRENT_PASSWORD);
    assert.equal(f.writes.length, 0);
    assert.equal((await f.update({ email: 'new@example.com', currentPassword: 'correct' }, admin)).ok, true);
  }
});

test('self email with active 2FA requires TOTP; unrelated edits and authorized admin edits remain allowed', async () => {
  const f = await usersFixture({ totp: true });
  assert.equal((await f.update({ email: 'new@example.com', currentPassword: 'correct' })).errorCode, ERR.TWO_FA_CODE_REQUIRED);
  assert.equal((await f.update({ email: 'new@example.com', currentPassword: 'correct', totpCode: '000000' })).errorCode, ERR.TOTP_INVALID);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.update({ email: 'new@example.com', currentPassword: 'correct', totpCode: '123456' })).ok, true);
  assert.equal((await f.update({ email: 'new@example.com', active: true })).ok, true);
  assert.equal((await f.update({ email: 'support@example.com' }, true, 99)).ok, true);
});

for (const [path, name, args] of [['lib/manager-2fa.js', 'disable2fa', [7]], ['lib/employee-2fa.js', 'disableEmployee2fa', [8, 9]]]) {
  test(`${name}: eleventh attempt is blocked before password/TOTP/database work`, async () => {
    let attempts = 0;
    let reads = 0;
    const keys = [];
    const api = await load(path, {
      query: async () => { reads++; return { rowCount: 1, rows: [{ role: 'hr', employmentStatus: 'employee', totpEnabledAt: 'now', passwordHash: 'hash' }] }; },
      checkRateLimit: async key => { keys.push(key); return ++attempts <= 10 ? { ok: true } : { ok: false, retryAfterSec: 900 }; },
      verifyPassword: async () => false, isManagerRole: () => true, EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' }, getJwtSecret: () => secret,
      generateTotpSecret: () => '', verifyTotpCode: () => false, buildOtpAuthUrl: () => '',
      issueSecondFactorChallenge: async () => ({}), secondFactorChallengeLive: async () => false,
    });
    for (let i = 0; i < 10; i++) assert.equal((await api[name](...args, { password: 'wrong', code: '000000' })).code, 'INVALID_CREDENTIALS');
    const denied = await api[name](...args, { password: 'wrong', code: '000000' });
    assert.equal(denied.code, 'RATE_LIMIT');
    assert.equal(denied.retryAfterSec, 900);
    assert.equal(reads, 10);
    assert.equal(new Set(keys).size, 1);
  });
}

for (const [path, manager] of [['app/api/auth/2fa/verify/route.js', true], ['app/api/auth/employee/2fa/verify/route.js', false]]) {
  test(`${path}: consumed challenge is mandatory and emitted session keeps its version`, async () => {
    let consumed = false;
    const sessions = [];
    const queries = [];
    const api = await load(path, {
      NextResponse: { json: body => body }, ERR, httpStatusForError: () => 401,
      apiError: (_request, code, status) => ({ code, status }),
      checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'ip', verifyTurnstileToken: async () => ({ ok: true }),
      verify2faChallenge: async () => 7, verifyEmployee2faChallenge: async () => ({ candidateId: 8, companyId: 9 }),
      verify2faLogin: async () => ({ ok: true }), verifyEmployee2faLogin: async () => ({ ok: true, person: { email: 'employee@example.com' } }),
      consumeSecondFactorChallenge: async () => consumed ? 2 : false, normalizeLocale: () => 'pt-BR',
      query: async (_sql, args) => { queries.push(args); return { rowCount: 1, rows: [{ id: 7, sessionVersion: args[1] }] }; },
      buildManagerLoginResponse: row => { sessions.push(row); return { status: 200 }; },
      buildEmployeeLoginResponse: opts => { sessions.push(opts); return { status: 200 }; },
    });
    const request = { json: async () => ({ challengeToken: 'token', code: '123456' }) };
    assert.equal((await api.POST(request)).status, 401);
    assert.equal(sessions.length, 0);
    consumed = true;
    assert.equal((await api.POST(request)).status, 200);
    assert.equal(manager ? sessions[0].sessionVersion : sessions[0].sv, 2);
    if (manager) assert.deepEqual(Array.from(queries[0]), [7, 2]);
  });
}
