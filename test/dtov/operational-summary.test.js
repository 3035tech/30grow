// Synthetic local PostgreSQL only; every fixture rolls back.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { loadOperationalSummaries } from '../../lib/people/operational-summary.js';
const db = new pg.Client({host:'127.0.0.1',port:55432,database:'enneagram_dtov',user:'dtov',password:'dtov_local_only',ssl:false});
await db.connect();
try {
  await db.query('BEGIN');
  const query=(...args)=>db.query(...args);
  const company = async name=>(await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',[name,crypto.randomUUID()])).rows[0].id;
  const a=await company('Operational A'), b=await company('Operational B');
  const person=async(cid,name)=>(await query("INSERT INTO candidates(company_id,full_name,employment_status) VALUES($1,$2,'employee') RETURNING id",[cid,name])).rows[0].id;
  const manager=await person(a,'Manager A'), employee=await person(a,'Employee A'), outsider=await person(b,'Employee B');
  await query('UPDATE candidates SET manager_candidate_id=$1 WHERE id=$2',[manager,employee]);
  const plan=(await query("INSERT INTO development_plans(company_id,candidate_id,title,status) VALUES($1,$2,'Plan','active') RETURNING id",[a,employee])).rows[0].id;
  await query("INSERT INTO development_plan_items(plan_id,company_id,title,due_date,status) VALUES($1,$2,'Late',CURRENT_DATE-1,'todo'),($1,$2,'Done',CURRENT_DATE-2,'done'),($1,$2,'Future',CURRENT_DATE+1,'todo')",[plan,a]);
  await query("INSERT INTO employee_onboarding_checkins(company_id,candidate_id,milestone_days,due_date,status) VALUES($1,$2,30,CURRENT_DATE-1,'pending')",[a,employee]);
  const course=(await query("INSERT INTO lms_courses(company_id,title) VALUES($1,'Course') RETURNING id",[a])).rows[0].id;
  await query("INSERT INTO lms_enrollments(company_id,course_id,candidate_id,due_date) VALUES($1,$2,$3,CURRENT_DATE-1)",[a,course,employee]);
  const result=await loadOperationalSummaries(query,[{candidateId:employee,companyId:a},{candidateId:outsider,companyId:a}]);
  assert.equal(result[employee].companyName,'Operational A');
  assert.equal(result[employee].managerName,'Manager A');
  assert.equal(result[employee].pdiOverdue,1);
  assert.equal(result[employee].onboardingOverdue,1);
  assert.equal(result[employee].lmsOverdue,1);
  assert.equal(result[employee].overdueCount,3);
  assert.equal(result[outsider],undefined,'foreign company pair must not return data');
  assert.deepEqual(await loadOperationalSummaries(()=>{throw Error('empty list must not query');},[]),{});
  console.log('Operational summary: real schema, overdue status, manager and tenant pairs passed');
} finally {await db.query('ROLLBACK');await db.end();}
