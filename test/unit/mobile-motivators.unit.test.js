import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { contentLocale, LOCALES, normalizeLocale } from '../../lib/locale-negotiation.js';

const zLocale = z.enum(LOCALES);

async function load(path, dependencies) {
  const context = vm.createContext({ console, URL, Buffer });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
  await module.evaluate();
  return module.namespace;
}

async function domain({ row = { id: 1, status: 'opened', definitionId: 1 }, status = 'in_progress', valid = true } = {}) {
  const calls = []; const notifications = [];
  const db = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes('FROM ae_invites')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    if (sql.includes('FROM areas')) return { rows: [{ id: 1 }], rowCount: 1 };
    if (sql.includes('FROM ae_attempts')) return { rows: [{ id: 2, status, questionIds: ['3'] }], rowCount: 1 };
    if (sql.startsWith('UPDATE')) return { rows: [], rowCount: 1 };
    throw new Error('Unexpected query');
  } };
  const dependencies = {
    asDb: () => db, ERR: { NOT_FOUND: 'NOT_FOUND', INVALID_DATA: 'INVALID_DATA' }, t: () => 'Consent',
    drawMotivatorsQuestions: async () => { throw new Error('must resume'); },
    loadQuestionsForScoring: async () => [{ id: '3', text: 'Pergunta', weight: 99 }],
    toPublicQuestions: (questions) => questions.map(({ id, text }) => ({ id, text })),
    computeMotivatorScores: () => ({ ok: valid, dimensionScores: {}, ranking: [] }),
    formatScoringFailure: () => null, summarizeScoringInput: () => ({}),
    resolveResultTextsFromDb: async () => ({ profileSummary: 'Summary', managerRecommendations: [] }),
    AE_SCORING_ENGINE_VERSION: 'test', notifyCompanyManagers: async (_db, input) => notifications.push(input),
    NOTIF: { MOTIVATORS_COMPLETED: 'completed' }, buildManagementHypotheses: () => ({ retentionSignals: [] }),
  };
  return { service: await load('../../lib/employee/employee-motivators.js', dependencies), db, calls, notifications };
}

test('foreign, expired and cancelled invites fail before loading questions or writing', async () => {
  for (const row of [null, { id: 1, status: 'cancelled' }, { id: 1, expired: true }]) {
    const { service, db, calls } = await domain({ row });
    const result = await service.changeEmployeeMotivators(db, { companyId: 2, candidateId: 20 }, { action: 'start', inviteId: '1', consent: true, areaKey: 'a' });
    assert.equal(result.errorCode, 'NOT_FOUND');
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /i.company_id = \$1 AND i.candidate_id = \$2/);
    assert.deepEqual(Array.from(calls[0].args), [2, 20, '1']);
  }
});

test('start resumes the locked employee attempt without exposing weights', async () => {
  const { service, db, calls } = await domain();
  const result = await service.changeEmployeeMotivators(db, { companyId: 1, candidateId: 10 }, { action: 'start', inviteId: '1', consent: true, areaKey: 'a', locale: 'en' });
  assert.equal(result.attemptId, '2');
  assert.equal(result.questions[0].weight, undefined);
  assert.match(calls[0].sql, /FOR UPDATE OF i/);
  assert.match(calls[2].sql, /company_id = \$2 AND candidate_id = \$3/);
  assert.equal(calls.filter((c) => c.sql.startsWith('INSERT')).length, 0);
});

test('invalid answers do not write; completion is tenant-scoped and replay does not notify again', async () => {
  for (const companyId of [1, 2]) {
    const run = await domain();
    const result = await run.service.changeEmployeeMotivators(run.db, { companyId, candidateId: 10 }, { action: 'submit', attemptId: '2', answers: [], locale: 'en' });
    assert.equal(result.completed, true);
    const update = run.calls.find((c) => c.sql.startsWith('UPDATE ae_attempts'));
    assert.deepEqual(Array.from(update.args).slice(-2), [companyId, 10]);
    assert.equal(run.notifications.length, 1);
  }
  const invalid = await domain({ valid: false });
  assert.equal((await invalid.service.changeEmployeeMotivators(invalid.db, { companyId: 1, candidateId: 10 }, { action: 'submit', attemptId: '2', answers: [] })).ok, false);
  assert.equal(invalid.calls.some((c) => c.sql.startsWith('UPDATE')), false);
  const replay = await domain({ status: 'completed', row: { id: 1, status: 'completed' } });
  assert.equal((await replay.service.changeEmployeeMotivators(replay.db, { companyId: 1, candidateId: 10 }, { action: 'submit', attemptId: '2' })).completed, true);
  assert.equal(replay.notifications.length, 0);
});

test('route requires session, consent and strict input; mutations run in a transaction', async () => {
  let session = null; let transactions = 0;
  const route = await load('../../app/api/mobile/v1/employee/motivators/route.js', {
    z, zLocale, normalizeLocale, NextResponse: { json: (body) => body }, apiError: (_r, code, status) => ({ code, status }), apiErrorFromResult: (_r, result) => result,
    ERR: { UNAUTHORIZED: 'UNAUTHORIZED', INVALID_DATA: 'INVALID_DATA', INTERNAL: 'INTERNAL', RATE_LIMIT: 'RATE_LIMIT' }, HTTP_STATUS: { UNAUTHORIZED: 401, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500, TOO_MANY_REQUESTS: 429 },
    authenticateMobileEmployee: async () => session, mobileEmployeeBearerToken: () => 'test', checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'test',
    MotivatorsAction: { Start: 'start', Submit: 'submit' }, withTransaction: async (fn) => { transactions++; return fn({}); },
    changeEmployeeMotivators: async (_db, scope) => ({ ok: true, companyId: scope.companyId }), listEmployeeMotivators: async () => ({}),
  });
  assert.equal((await route.POST({})).status, 401);
  session = { companyId: 1, candidateId: 10 };
  const base = { action: 'start', inviteId: '1', consent: true, areaKey: 'a', locale: 'en' };
  for (const input of [{ ...base, consent: false }, { ...base, companyId: 2 }, { ...base, inviteId: '../2' }, { ...base, inviteToken: 'secret' }]) {
    assert.equal((await route.POST({ text: async () => JSON.stringify(input) })).status, 400);
  }
  assert.equal(transactions, 0);
  assert.equal((await route.POST({ text: async () => JSON.stringify(base) })).companyId, 1);
  assert.equal(transactions, 1);
});

test('public web start and submit share the invite lock and reject a completed invitation', async () => {
  for (const action of ['start', 'submit']) {
    const calls = [];
    const dependencies = {
      NextResponse: { json: (body) => body }, apiError: (_request, code, status) => ({ code, status }), contentLocale,
      ERR: { INVITE_NOT_AVAILABLE: 'INVITE_NOT_AVAILABLE', SESSION_DONE: 'SESSION_DONE' },
      withTransaction: async (fn) => fn({ query: async (sql) => { calls.push(sql); return { rowCount: 1, rows: [{ status: 'completed', expiresAt: '2999-01-01', expired: false, inviteEmail: 'person@example.com' }] }; } }),
      checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'test',
      titleCasePersonName: (value) => value, normalizeEmail: (value) => value,
      drawMotivatorsQuestions: () => { throw new Error('must not draw'); }, upsertCandidate: () => { throw new Error('must not upsert'); }, toPublicQuestions: () => [],
      loadQuestionsForScoring: () => { throw new Error('must not score'); }, computeMotivatorScores: () => {}, resolveResultTextsFromDb: () => {},
      AE_SCORING_ENGINE_VERSION: 'test', bootstrapMotivators: () => {}, formatScoringFailure: () => {}, summarizeScoringInput: () => {},
      notifyCompanyManagers: () => { throw new Error('must not notify'); }, NOTIF: {}, buildManagementHypotheses: () => {},
    };
    const route = await load(`../../app/api/ae/${action}/route.js`, dependencies);
    const result = await route.POST({ json: async () => ({ inviteToken: 'test-token', name: 'Person', email: 'person@example.com', areaKey: 'a', consent: true, attemptId: 2, answers: [] }) });
    assert.equal(result.status, action === 'start' ? 403 : 409);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /FOR UPDATE OF i/);
  }
});
