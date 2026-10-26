import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from '../dtov/harness.js';
assert.equal(process.env.EMPLOYEE_ADMISSION_TEST,'1','Explicit local test opt-in required');
const env = dtovEnv(); assertDtovTarget(env);
if (process.env.ADMISSION_TEST_PG_PORT !== undefined) { assert.equal(process.env.ADMISSION_TEST_PG_PORT,'55489'); env.POSTGRES_PORT='55489'; env.REDIS_URL=''; }
Object.assign(process.env,env);
const { query, pool, withTransaction } = await import('../../lib/db.js');
const { admitCandidateAsEmployee, createEmployeeDirect, listCandidateHiringLinks, maybeCloseVacancyIfFilled } = await import('../../lib/recruiting/hire.js');
const auth = await import('../../lib/employee/employee-auth.js');
const mail = await import('../../lib/mail.js');
const pipeline = await import('../../lib/recruiting/pipeline.js');
const { resolveRecruitingPipelineStage } = await import('../../lib/recruiting/pipeline-templates.js');
const { CAP, isSuperAdminPayload, requireCapability, canAccessCandidateRecord } = await import('../../lib/permissions.js');
const { ERR, httpStatusForError } = await import('../../lib/api-error-codes.js');
const { normalizeOnboardingStages } = await import('../../lib/onboarding-stage-selection.js');
const { closeRateLimitRedis } = await import('../../lib/rate-limit.js');
const { sanitizeInterviewNotesHtml } = await import('../../lib/sanitize-html.js');
const get = async id => (await query(`SELECT *,id AS "candidateId",company_id AS "companyId" FROM candidates WHERE id=$1`,[id])).rows[0];
let companyId, otherCompanyId;
async function loadPipeline(path) {
  const deps = { ...pipeline, normalizeOnboardingStages, query,queryRead:query,withTransaction,
    NextResponse:{json:Response.json},cookies:async()=>({get:()=>({value:'synthetic-session'})}),COOKIE_NAME:'session',
    verifySessionWithCapabilities:async()=>({role:'hr',userId:null,companyId}), CAP,isSuperAdminPayload,requireCapability,canAccessCandidateRecord,
    resolveRecruitingPipelineStage,sanitizeInterviewNotesHtml,ERR,httpStatusForError,
    apiError:(_,code,status)=>Response.json({errorCode:code},{status}),
    apiErrorFromResult:(_,result)=>Response.json(result,{status:httpStatusForError(result.errorCode,400)}),
    localeFromRequest:()=> 'pt-BR',audit:async()=>{},auditFromRequest:async()=>{},
    pipelineStageToFunnelEvent:()=>null,scheduleJobFunnelEvent:()=>{},
  };
  const context = vm.createContext({ console, Response });
  const compiled = new vm.SourceTextModule(await readFile(new URL('../../'+path,import.meta.url),'utf8'),{context});
  await compiled.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[key,value]of Object.entries(deps))this.setExport(key,value);},{context}));
  await compiled.evaluate(); return compiled.namespace;
}
try {
  companyId=(await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',['Synthetic admission','admission-'+randomUUID()])).rows[0].id;
  otherCompanyId=(await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',['Synthetic other employer','other-'+randomUUID()])).rows[0].id;
  const add=async()=>{const email=randomUUID()+'@example.test';return (await query(`INSERT INTO candidates(company_id,full_name,email,hr_notes) VALUES($1,'Synthetic candidate',$2,'Original private history') RETURNING id,email`,[companyId,email])).rows[0];};
  for(const kind of ['candidate','assessment']) await test(`${kind}: hiring forecast never activates employment, access, onboarding or fills the vacancy`,async()=>{
    const person=await add(); const vacancyId=(await query(`INSERT INTO vacancies(company_id,title,slug,positions_count) VALUES($1,'Future hiring',$2,1) RETURNING id`,[companyId,'future-'+randomUUID()])).rows[0].id;
    await query(`INSERT INTO vacancy_candidates(company_id,candidate_id,vacancy_id,pipeline_stage) VALUES($1,$2,$3,'approved')`,[companyId,person.id,vacancyId]);
    let assessmentId;
    if(kind==='assessment'){
      const areaId=(await query('SELECT id FROM areas ORDER BY id LIMIT 1')).rows[0].id;
      assessmentId=(await query(`INSERT INTO assessments(company_id,candidate_id,vacancy_id,area_id,top_type,scores,pipeline_stage) VALUES($1,$2,$3,$4,1,'{}','approved') RETURNING id`,[companyId,person.id,vacancyId,areaId])).rows[0].id;
    }
    const route=await loadPipeline(kind==='assessment'?'app/api/admin/assessments/[id]/route.js':'app/api/admin/vacancies/[id]/candidates/[candidateId]/route.js');
    const params=kind==='assessment'?{id:assessmentId}:{id:vacancyId,candidateId:person.id};
    mail.__resetMailMockLog();
    const moved=await route.PATCH({json:async()=>({pipelineStage:'hired',startDate:'2099-01-01',corporateEmail:'future@work.example.test',onboardingStages:[]})},{params});
    assert.equal(moved.status,200,JSON.stringify(await moved.clone().json()));
    const pending=await get(person.id);
    assert.equal(pending.employment_status,'candidate'); assert.equal(pending.email,person.email);
    assert.equal(pending.hired_at,null); assert.equal(pending.start_date,null);
    assert.equal((await auth.findEmployeesByEmail(query,{companyId,email:person.email})).length,0);
    assert.equal((await auth.issueEmployeePasswordInvite(query,{companyId,candidateId:person.id})).ok,false);
    assert.equal(mail.__getMailMockLog().length,0);
    assert.equal((await query('SELECT count(*)::int n FROM employee_onboarding_checkins WHERE candidate_id=$1',[person.id])).rows[0].n,0);
    assert.equal((await query('SELECT count(*)::int n FROM employee_pre_onboarding_items WHERE candidate_id=$1',[person.id])).rows[0].n,0);
    assert.equal((await maybeCloseVacancyIfFilled(vacancyId)).closed,false);
    assert.equal((await listCandidateHiringLinks(query,{companyId,candidateId:person.id}))[0].plannedStartDate,'2099-01-01');
    const future=await admitCandidateAsEmployee({companyId,candidateId:person.id,startDate:'2099-01-01',personalEmail:person.email,sendAccessInvite:true});
    assert.equal(future.errorCode,ERR.ADMISSION_NOT_STARTED);
    const declined=await route.PATCH({json:async()=>({pipelineStage:'rejected',rejectionReasons:['other']})},{params});
    assert.equal(declined.status,200); assert.equal((await get(person.id)).employment_status,'candidate');
    assert.equal((await listCandidateHiringLinks(query,{companyId,candidateId:person.id})).length,0);
  });
  await test('explicit admission preserves identity/history and scopes the actual vacancy and invitation',async()=>{
    const person=await add(); const corporate=randomUUID()+'@work.example.test';
    const vacancyId=(await query(`INSERT INTO vacancies(company_id,title,slug,positions_count) VALUES($1,'Actual admission',$2,1) RETURNING id`,[companyId,'actual-'+randomUUID()])).rows[0].id;
    await query(`INSERT INTO vacancy_candidates(company_id,candidate_id,vacancy_id,pipeline_stage,start_date) VALUES($1,$2,$3,'hired','2099-01-01')`,[companyId,person.id,vacancyId]);
    const input={companyId,candidateId:person.id,vacancyId,startDate:'2020-01-01',personalEmail:person.email,corporateEmail:corporate,onboardingStages:[],sendAccessInvite:false};
    mail.__resetMailMockLog();
    assert.equal((await admitCandidateAsEmployee({...input,companyId:otherCompanyId})).errorCode,ERR.CANDIDATE_NOT_FOUND);
    const result=await admitCandidateAsEmployee(input); assert.equal(result.ok,true);
    assert.equal(result.candidateId,person.id);assert.equal(result.employeeAccessState,'not_invited');
    const active=await get(person.id);assert.equal(active.employment_status,'employee');assert.equal(active.email,corporate);assert.equal(active.personal_email,person.email);
    assert.equal(active.hr_notes,'Original private history');assert.equal(active.hired_vacancy_id,vacancyId);
    assert.equal((await query('SELECT status FROM vacancies WHERE id=$1',[vacancyId])).rows[0].status,'closed');
    assert.equal(mail.__getMailMockLog().length,0);
    assert.equal((await admitCandidateAsEmployee({...input,sendAccessInvite:true})).alreadyEmployee,true);
    assert.equal(mail.__getMailMockLog().length,0,'repeated admission does not send a second invitation');
    const invite=await auth.issueEmployeePasswordInvite(query,{companyId,candidateId:person.id,returnUrl:true});
    assert.equal(invite.ok,true);assert.equal(mail.__getMailMockLog().at(-1).to,corporate);
    assert.equal((await auth.completeEmployeePasswordSetup(query,{token:new URL(invite.setupUrl).searchParams.get('token'),password:'Synthetic-access!2026'})).ok,true);
    const loggedIn=await auth.loginEmployeeWithPassword(query,{companyId,email:corporate,password:'Synthetic-access!2026'});
    assert.equal(loggedIn.ok,true);assert.equal(loggedIn.candidateId,person.id);
  });
  await test('direct inclusion reuses a known candidate and preserves personal contact when work email differs',async()=>{
    const person=await add();const corporate=randomUUID()+'@work.example.test';
    const result=await createEmployeeDirect({companyId,fullName:'Must not replace the original identity',email:corporate,personalEmail:person.email,startDate:'2020-01-01',onboardingStages:[],sendAccessInvite:false});
    assert.equal(result.ok,true);assert.equal(result.candidateId,person.id);
    const active=await get(person.id);assert.equal(active.personal_email,person.email);assert.equal(active.email,corporate);
    assert.equal(active.full_name,'Synthetic candidate');assert.equal(active.hr_notes,'Original private history');
    const count=(await query('SELECT count(*)::int n FROM candidates WHERE company_id=$1 AND (email=$2 OR personal_email=$3)',[companyId,corporate,person.email])).rows[0].n;assert.equal(count,1);
    const future=await createEmployeeDirect({companyId,fullName:'Future employee',email:randomUUID()+'@example.test',startDate:'2099-01-01'});assert.equal(future.errorCode,ERR.ADMISSION_NOT_STARTED);
  });
  await test('arrival notification is emitted once at actual admission and respects dispensed arrival',async()=>{
    await query(`INSERT INTO users(company_id,email,password_hash,role) VALUES($1,$2,'synthetic-unused-hash','hr')`,[companyId,randomUUID()+'@example.test']);
    for (const stages of [[],['arrival']]) {
      const person=await add();
      const input={companyId,candidateId:person.id,startDate:'2020-01-01',personalEmail:person.email,onboardingStages:stages,sendAccessInvite:false};
      assert.equal((await admitCandidateAsEmployee(input)).ok,true);
      assert.equal((await admitCandidateAsEmployee(input)).alreadyEmployee,true);
      const result=await query("SELECT count(*)::int n FROM manager_notifications WHERE company_id=$1 AND entity_id=$2 AND type='hire_onboarding_kit'",[companyId,person.id]);
      assert.equal(result.rows[0].n,stages.length ? 1 : 0);
    }
  });
  await test('current employee can join with only corporate email, receive access and leave without a personal address',async()=>{
    const corporate=randomUUID()+'@work.example.test';
    mail.__resetMailMockLog();
    const result=await createEmployeeDirect({companyId,fullName:'Current corporate-only employee',email:corporate,
      startDate:'2020-01-01',entryMode:'existing_employee',sendAccessInvite:true});
    assert.equal(result.ok,true);assert.equal(result.inviteSent,true);
    const active=await get(result.candidateId);
    assert.equal(active.employment_status,'employee');assert.equal(active.email,corporate);
    assert.equal(active.personal_email,null,'work address must never be inferred as personal');
    assert.equal(mail.__getMailMockLog().at(-1).to,corporate);
    const choices=await query('SELECT stage_key,enabled FROM employee_onboarding_stage_choices WHERE company_id=$1 AND candidate_id=$2',[companyId,result.candidateId]);
    assert.equal(choices.rowCount,4);assert.ok(choices.rows.every(row=>row.enabled===false));
    const token=active.password_setup_token;
    assert.ok(token);
    const {createExitRecord}=await import('../../lib/exit-analysis.js');
    const exit=await createExitRecord(null,{companyId,candidateId:result.candidateId,exitDate:'2026-01-01',exitType:'voluntary',exitReason:'other'});
    assert.equal(exit.ok,true);
    const alumni=await get(result.candidateId);
    assert.equal(alumni.employment_status,'alumni');assert.equal(alumni.email,null);assert.equal(alumni.personal_email,null);
    assert.equal(alumni.password_setup_token,null);assert.equal(alumni.password_hash,null);
    assert.equal((await auth.findEmployeesByEmail(query,{companyId,email:corporate})).length,0);
  });
} finally { await pool.end(); await closeRateLimitRedis(); }
