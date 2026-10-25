import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from '../dtov/harness.js';
assert.equal(process.env.ONBOARDING_STAGES_TEST, '1', 'Explicit local opt-in required');
const env = dtovEnv(); assertDtovTarget(env);
if (process.env.ONBOARDING_TEST_PG_PORT !== undefined) {
  // A second, fixed local disposable target when Docker cannot publish 55432.
  assert.equal(process.env.ONBOARDING_TEST_PG_PORT, '55489');
  env.POSTGRES_PORT = '55489';
}
Object.assign(process.env, env);
const { query, pool, withTransaction } = await import('../../lib/db.js');
const { createEmployeeDirect, persistCandidateHire, markCandidateHired, notifyHireOnboardingKit } = await import('../../lib/hire.js');
const { findEmployeesByEmail, issueEmployeePasswordInvite, completeEmployeePasswordSetup, loginEmployeeWithPassword } = await import('../../lib/employee-auth.js');
const { __getMailMockLog } = await import('../../lib/mail.js');
const { closeRateLimitRedis } = await import('../../lib/rate-limit.js');
const { ensurePreOnboardingChecklist } = await import('../../lib/people/pre-onboarding.js');
const { ensureOnboardingCheckins } = await import('../../lib/people/onboarding-checkins.js');
const { getEmployeeOnboardingJourney, buildOnboardingTasksFromJourney } = await import('../../lib/people/employee-onboarding-journey.js');
try {
  const companyId = (await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', ['Synthetic stage choices', 'stage-choices-' + randomUUID()])).rows[0].id;
  const otherCompanyId = (await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', ['Synthetic stage isolation', 'stage-isolation-' + randomUUID()])).rows[0].id;
  const create = stages => createEmployeeDirect({ companyId, fullName: 'Synthetic employee', email: randomUUID() + '@example.test', startDate: '2020-01-01', sendAccessInvite: false, ...(stages === undefined ? {} : { onboardingStages: stages }) });
  await test('omitted selection preserves the existing complete journey', async () => {
    const result = await create(); assert.equal(result.ok, true);
    const journey = await getEmployeeOnboardingJourney(query, { companyId, candidateId: result.candidateId });
    assert.equal(journey.checkins.length, 3); assert.ok(journey.preItems.length > 0);
    assert.ok([...journey.checkins, ...journey.preItems].every(item => item.status === 'pending'));
  });
  await test('individual selection survives reseeding, preserves admission and excludes skipped tasks', async () => {
    const result = await create(['d60']); assert.equal(result.ok, true);
    await ensurePreOnboardingChecklist(query, { companyId, candidateId: result.candidateId });
    await ensureOnboardingCheckins(query, { companyId, candidateId: result.candidateId });
    const journey = await getEmployeeOnboardingJourney(query, { companyId, candidateId: result.candidateId });
    assert.equal(journey.startDate, '2020-01-01');
    assert.ok(journey.preItems.every(item => item.status === 'skipped'));
    assert.deepEqual(journey.checkins.map(item => [item.milestoneDays, item.status]), [[30,'skipped'],[60,'pending'],[90,'skipped']]);
    const tasks = buildOnboardingTasksFromJourney(journey);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].kind, 'onboarding_checkin');
    assert.ok([...journey.preItems, ...journey.checkins].filter(item => item.status === 'skipped').every(item => item.overdue === false));
  });
  await test('deselect all creates no employee-home onboarding obligations, including after template changes', async () => {
    const result = await create([]); assert.equal(result.ok, true);
    await query(`INSERT INTO company_pre_onboarding_templates(company_id,item_key,label_pt,label_en,owner_role,due_offset_days,sort_order,active)
      VALUES($1,'synthetic_later','Extra','Extra','rh',0,900,true)`, [companyId]);
    await ensurePreOnboardingChecklist(query, { companyId, candidateId: result.candidateId });
    const journey = await getEmployeeOnboardingJourney(query, { companyId, candidateId: result.candidateId });
    assert.equal(buildOnboardingTasksFromJourney(journey).length, 0);
    assert.equal((await notifyHireOnboardingKit(query, { companyId, candidateId: result.candidateId })).skipped, true);
    assert.ok([...journey.checkins, ...journey.preItems].every(item => item.status === 'skipped'));
    const ddl = await readFile(new URL('../../migrations/172_employee_onboarding_stage_choices.sql', import.meta.url), 'utf8');
    await query(ddl); await query(ddl);
    assert.equal((await query('SELECT count(*)::int n FROM employee_onboarding_stage_choices WHERE candidate_id=$1', [result.candidateId])).rows[0].n, 4);
    await assert.rejects(query(`INSERT INTO employee_onboarding_stage_choices(company_id,candidate_id,stage_key,enabled) VALUES($1,$2,'arrival',true)`, [otherCompanyId,result.candidateId]), { code: '23503' });
  });
  await test('hire and choices roll back together before any post-commit task generation', async () => {
    const candidateId = (await query(`INSERT INTO candidates(company_id,full_name,email) VALUES($1,'Rollback fixture',$2) RETURNING id`, [companyId, randomUUID()+'@example.test'])).rows[0].id;
    await assert.rejects(withTransaction(async db => { await persistCandidateHire(db, { candidateId, startDate: '2020-01-01', onboardingStages: [] }); throw new Error('synthetic rollback'); }), /synthetic rollback/);
    assert.equal((await query('SELECT employment_status status FROM candidates WHERE id=$1', [candidateId])).rows[0].status, 'candidate');
    assert.equal((await query('SELECT count(*)::int n FROM employee_onboarding_stage_choices WHERE candidate_id=$1', [candidateId])).rows[0].n, 0);
  });
  await test('an existing candidate becomes the same employee and can activate corporate-email access', async () => {
    const personal = randomUUID() + '@example.test', corporate = randomUUID() + '@work.example.test';
    const candidateId = (await query(`INSERT INTO candidates(company_id,full_name,email,hr_notes) VALUES($1,'Existing candidate',$2,'Preserve candidate history') RETURNING id`, [companyId,personal])).rows[0].id;
    assert.equal((await findEmployeesByEmail(query, { email: personal, companyId })).length, 0);
    assert.equal((await issueEmployeePasswordInvite(query, { companyId, candidateId })).ok, false, 'candidate has no employee invitation yet');
    await markCandidateHired({ candidateId, startDate: '2020-01-01', corporateEmail: corporate, inviteAccess: true, autoInvite: false, onboardingStages: [] });
    const person = (await query('SELECT id,email,personal_email,employment_status,hr_notes FROM candidates WHERE id=$1', [candidateId])).rows[0];
    assert.equal(person.id, candidateId); assert.equal(person.employment_status, 'employee');
    assert.equal(person.email, corporate); assert.equal(person.personal_email, personal);
    assert.equal(person.hr_notes, 'Preserve candidate history');
    const invitation = await issueEmployeePasswordInvite(query, { companyId, candidateId, returnUrl: true });
    assert.equal(invitation.ok, true); assert.equal(__getMailMockLog().at(-1).to, corporate);
    const token = new URL(invitation.setupUrl).searchParams.get('token');
    const password = 'Synthetic-only!2026';
    assert.equal((await completeEmployeePasswordSetup(query, { token, password })).ok, true);
    const login = await loginEmployeeWithPassword(query, { email: corporate, password, companyId });
    assert.equal(login.ok, true); assert.equal(login.candidateId, candidateId);
    assert.equal((await loginEmployeeWithPassword(query, { email: personal, password, companyId })).ok, false);
    assert.equal((await loginEmployeeWithPassword(query, { email: corporate, password, companyId: otherCompanyId })).ok, false);
    assert.equal(buildOnboardingTasksFromJourney(await getEmployeeOnboardingJourney(query, { companyId, candidateId })).length, 0);
  });
} finally { await pool.end(); await closeRateLimitRedis(); }
