import { normalizeOnboardingStages } from '../../lib/onboarding-stage-selection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as pipeline from '../../lib/recruiting/pipeline.js';
import { ERR } from '../../lib/api-error-codes.js';

async function fixture({ authorized = true, companyId = 3, admin = false, found = true, events = [] } = {}) {
  const calls = [];
  const deps = {
    normalizeOnboardingStages,
    ...pipeline, localeFromRequest: () => 'pt-BR', ERR, NextResponse: { json: Response.json }, COOKIE_NAME: 'session', cookies: async () => ({ get: () => ({ value: 'fixture' }) }),
    verifySessionWithCapabilities: async () => ({ companyId }), requireCapability: () => authorized, CAP: { VACANCIES_VIEW: 'view', VACANCIES_MANAGE: 'manage' }, isSuperAdminPayload: () => admin,
    query: async (sql, values) => { calls.push({sql,values}); return calls.length === 1 ? {rowCount:found?1:0,rows:found?[{companyId:3,candidateId:12,interviewNotes:'Saved notes'}]:[]} : {rowCount:events.length,rows:events}; },
    withTransaction: () => { throw new Error('GET must never write'); }, sanitizeInterviewNotesHtml: (x) => x,
    apiError: (_,code,status) => Response.json({code},{status}), apiErrorFromResult: () => {}, resolveRecruitingPipelineStage: () => {},
    persistCandidateHire: () => {}, runCandidateHireEffects: () => {}, maybeCloseVacancyIfFilled: () => {}, notifyHireOnboardingKit: () => {},
    pipelineStageToFunnelEvent: () => {}, scheduleJobFunnelEvent: () => {}, auditFromRequest: () => {},
  };
  const context = vm.createContext({ console, Response });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js',import.meta.url),'utf8'),{context});
  await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));
  await mod.evaluate();
  return {calls,get:(params={id:'29',candidateId:'12'})=>mod.namespace.GET({}, {params:Promise.resolve(params)})};
}

test('dialog denies unauthenticated/missing-company requests before reading candidature data',async()=>{
  for(const options of [{authorized:false},{companyId:null}]) {
    const f=await fixture(options);assert.equal((await f.get()).status,401);assert.equal(f.calls.length,0);
  }
});
test('dialog validates IDs and stops before querying unrelated history for a missing candidature',async()=>{
  const invalid=await fixture();assert.equal((await invalid.get({id:'invalid',candidateId:'12'})).status,400);assert.equal(invalid.calls.length,0);
  const missing=await fixture({found:false});assert.equal((await missing.get()).status,404);assert.equal(missing.calls.length,1);
});
test('dialog reads the vacancy and candidate within the session company, including both history sources',async()=>{
  const f=await fixture({events:[{eventKey:'assessment:1',reasons:['salary','skill_gap']}]});
  const response=await f.get();assert.equal(response.status,200);const data=await response.json();
  assert.deepEqual(Array.from(f.calls[0].values),[29,12,3]);
  assert.deepEqual(Array.from(f.calls[1].values),[29,12,3]);
  assert.match(f.calls[0].sql,/c.company_id = v.company_id/);
  assert.match(f.calls[0].sql,/vc.id IS NOT NULL OR EXISTS/); // Assessments imported without a vacancy_candidates row remain accessible.
  assert.match(f.calls[1].sql,/assessment_pipeline_history/);assert.match(f.calls[1].sql,/vacancy_candidate_pipeline_history/);
  assert.deepEqual(data.history[0].reasons,['salary','skill_gap']);assert.equal(data.interviewNotes,'Saved notes');
});
test('platform admin history is scoped to the company of the loaded candidature, not URL state',async()=>{
  const f=await fixture({admin:true,companyId:999});await f.get();assert.deepEqual(Array.from(f.calls[0].values),[29,12]);assert.equal(f.calls[1].values[2],3);
});
test('dialog bounds history and signals the full profile when more events exist',async()=>{
  const f=await fixture({events:Array.from({length:31},(_,id)=>({eventKey:`assessment:${id}`}))});
  const data=await(await f.get()).json();assert.equal(data.history.length,30);assert.equal(data.historyTruncated,true);
});
