import { normalizeOnboardingStages } from '../../lib/onboarding-stage-selection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PIPELINE_STAGE, normalizeRejectionReason, normalizeRejectionReasons, normalizeStartDate, rejectionReasonsSql } from '../../lib/pipeline.js';
import { ERR } from '../../lib/api-error-codes.js';

async function load(path, deps) {
  const context = vm.createContext({ console });
  const mod = new vm.SourceTextModule(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'), { context });
  await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
  }, { context }));
  await mod.evaluate();
  return mod.namespace;
}

async function fixture({ canonicalKey = 'screening', found = true, accessible = true, admin = false } = {}) {
  const calls = [], resolutions = [], events = [], hires = [];
  const row = { id: 42, currentStage: 'test_completed', pipelineStage: 'test_completed', candidateId: 12, vacancyId: 29, companyId: 3 };
  const db = async (sql, args) => {
    calls.push({ sql, args });
    if (sql.includes('SELECT')) return { rowCount: accessible ? 1 : 0, rows: accessible ? [row] : [] };
    return { rowCount: 1, rows: [{ id: 42, pipelineStage: sql.includes('UPDATE assessments') ? args[1] : args[5], rejectionReasons: sql.includes('UPDATE assessments') ? args[6] : args[10] }] };
  };
  const deps = {
    normalizeOnboardingStages,
    NextResponse: { json: (body) => ({ status: 200, body }) }, cookies: async () => ({ get: () => ({ value: 'session' }) }), COOKIE_NAME: 'session',
    verifySessionWithCapabilities: async () => ({ userId: 7, companyId: admin ? null : 3 }),
    canAccessCandidateRecord: () => true, isSuperAdminPayload: () => admin, requireCapability: () => true, CAP: { VACANCIES_MANAGE: 'manage' },
    query: db, queryRead: db, withTransaction: (fn) => fn({ query: db }),
    audit: async () => {}, auditFromRequest: async () => {},
    localeFromRequest: () => 'pt-BR', ERR, apiError: (_, code, status) => ({ code, status }), apiErrorFromResult: (_, result) => result,
    PIPELINE_STAGE, normalizeRejectionReason, normalizeRejectionReasons, normalizeStartDate, rejectionReasonsSql, sanitizeInterviewNotesHtml: (v) => v,
    resolveRecruitingPipelineStage: async (scope) => { resolutions.push(scope); return found ? { stageKey: scope.stageKey, canonicalKey } : null; },
    pipelineStageToFunnelEvent: (stage) => { events.push(stage); return null; }, scheduleJobFunnelEvent: () => {},
    persistCandidateHire: async (_, data) => { hires.push(data); }, runCandidateHireEffects: async () => {}, maybeCloseVacancyIfFilled: async () => {}, notifyHireOnboardingKit: async () => {},
  };
  return { calls, resolutions, events, hires, deps };
}

for (const [kind, path, params] of [
  ['assessment', 'app/api/admin/assessments/[id]/route.js', { id: '42' }],
  ['candidate', 'app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js', { id: '29', candidateId: '12' }],
]) {
  const move = async (f, body) => (await load(path, f.deps)).PATCH({ json: async () => body }, { params: Promise.resolve(params) });
  test(`${kind}: custom forwarding stage persists its key and resolves within the record's company/vacancy`, async () => {
    const f = await fixture();
    const result = await move(f, { pipelineStage: 'c_encaminhado_cliente' });
    assert.equal(result.status, 200);
    assert.equal(result.body.pipelineStage, 'c_encaminhado_cliente');
    assert.equal(f.resolutions[0].companyId, 3);
    assert.equal(String(f.resolutions[0].vacancyId), '29');
    assert.equal(f.events[0], 'screening');
    const history = f.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('history'));
    assert.equal(history.args[2], 'c_encaminhado_cliente');
    assert.equal(f.hires.length, 0);
  });
  for (const input of [ { rejectionReasons: ['salary', 'skill_gap', 'salary'] }, { rejectionReason: 'salary' } ]) {
    test(`${kind}: rejects with all reasons, deduplicates and accepts legacy payload ${JSON.stringify(input)}`, async () => {
      const f = await fixture({ canonicalKey: 'rejected' });
      const result = await move(f, { pipelineStage: 'rejected', ...input });
      assert.equal(result.status, 200);
      const expected = input.rejectionReasons ? ['salary', 'skill_gap'] : ['salary'];
      assert.deepEqual(Array.from(result.body.rejectionReasons), expected);
      const history = f.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('history'));
      assert.deepEqual(Array.from(history.args[6]), expected);
      assert.equal(history.args[3], expected[0]);
    });
  }
  for (const reasons of [[], ['salary', 'unknown'], [null], 'salary,skill_gap']) {
    test(`${kind}: empty or invalid reason list cannot write ${JSON.stringify(reasons)}`, async () => {
      const f = await fixture({ canonicalKey: 'rejected' });
      assert.equal((await move(f, { pipelineStage: 'rejected', rejectionReasons: reasons })).code, ERR.REJECTION_REASON_REQUIRED);
      assert.equal(f.calls.some((c) => /UPDATE|INSERT/.test(c.sql)), false);
    });
  }
  test(`${kind}: a stage outside this vacancy is rejected without writes`, async () => {
    const f = await fixture({ found: false });
    assert.equal((await move(f, { pipelineStage: 'c_other_company' })).code, ERR.INVALID_PIPELINE_STAGE);
    assert.equal(f.calls.some((c) => /UPDATE|INSERT/.test(c.sql)), false);
  });
  test(`${kind}: hire carries the optional corporate email into the atomic hire`, async () => {
    const f = await fixture({ canonicalKey: 'hired' });
    const result = await move(f, { pipelineStage: 'hired', startDate: '2026-10-22', corporateEmail: 'work@example.test' });
    assert.equal(result.status, 200);
    assert.equal(f.hires[0].corporateEmail, 'work@example.test');
    assert.equal(f.hires[0].inviteAccess, true);
  });
  test(`${kind}: selected onboarding stages reach the atomic hire, including an empty selection`, async () => {
    for (const stages of [[], ['arrival', 'd90']]) {
      const f = await fixture({ canonicalKey: 'hired' });
      const result = await move(f, { pipelineStage: 'hired', startDate: '2026-10-22', onboardingStages: stages });
      assert.equal(result.status, 200);
      assert.deepEqual(Array.from(f.hires[0].onboardingStages), stages);
    }
  });
  test(`${kind}: invalid onboarding stages cannot mutate the pipeline`, async () => {
    for (const stages of [null, ['d30', 'd30'], ['other_company_stage'], 'd30']) {
      const f = await fixture({ canonicalKey: 'hired' });
      assert.equal((await move(f, { pipelineStage: 'hired', startDate: '2026-10-22', onboardingStages: stages })).status, 400);
      assert.equal(f.calls.some(call => /UPDATE|INSERT/.test(call.sql)), false);
    }
  });
  for (const [canonicalKey, code] of [['hired', ERR.START_DATE_REQUIRED], ['rejected', ERR.REJECTION_REASON_REQUIRED]]) {
    test(`${kind}: custom ${canonicalKey} keeps required transition fields`, async () => {
      const f = await fixture({ canonicalKey });
      assert.equal((await move(f, { pipelineStage: `c_${canonicalKey}` })).code, code);
      assert.equal(f.calls.some((c) => /UPDATE|INSERT/.test(c.sql)), false);
    });
  }
}

test('assessment: inaccessible records do not resolve stages or write', async () => {
  const f = await fixture({ accessible: false });
  const route = await load('app/api/admin/assessments/[id]/route.js', f.deps);
  assert.equal((await route.PATCH({ json: async () => ({ pipelineStage: 'c_forwarded' }) }, { params: { id: '42' } })).status, 404);
  assert.equal(f.resolutions.length, 0);
});

test('resolver uses vacancy snapshot rather than the company catalog and rejects another vacancy stage', async () => {
  const queries = [];
  let companyReads = 0;
  const stages = [{ id: 1, companyId: 3, stageKey: 'c_forwarded', canonicalKey: 'screening' }];
  const queryRead = async (sql, args) => { queries.push(args); return { rowCount: 1, rows: sql.includes('FROM vacancy_pipeline_stages') ? stages : [] }; };
  const lib = await load('lib/pipeline-templates.js', { queryRead, query: queryRead, pool: {}, ERR, createCompanyPipelineStage: () => {}, listCompanyPipelineStages: async () => { companyReads++; return [{ stageKey: 'interview', canonicalKey: 'interview' }]; } });
  assert.equal((await lib.resolveRecruitingPipelineStage({ companyId: 3, vacancyId: 29, stageKey: 'c_forwarded' })).canonicalKey, 'screening');
  assert.equal(await lib.resolveRecruitingPipelineStage({ companyId: 3, vacancyId: 29, stageKey: 'interview' }), null);
  assert.equal(companyReads, 0);
  assert.deepEqual(Array.from(queries[0]), [3, 29]);
  assert.equal((await lib.resolveRecruitingPipelineStage({ companyId: 3, vacancyId: null, stageKey: 'interview' })).canonicalKey, 'interview');
  assert.equal(companyReads, 1);
});
