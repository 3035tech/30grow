import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const enabled = process.env.EMAIL_LIFECYCLE_PG_TEST === '1';
test('email lifecycle: hire → corporate contact → exit → personal contact → rehire, with real PostgreSQL and mocked mail', { skip: !enabled }, async () => {
  // Fixed disposable target. No .env, real mail or production credentials.
  Object.assign(process.env, { POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '55488', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'local-rejection-test', POSTGRES_DB: 'rejection_validation', POSTGRES_SSL: 'false', SMTP_MOCK: '1', NEXT_PUBLIC_APP_URL: 'https://email-test.example' });
  const { pool, query, withTransaction } = await import('../../lib/db.js');
  const { persistCandidateHire, rehireEmployee } = await import('../../lib/hire.js');
  const { finishHireEmail } = await import('../../lib/hire-email.js');
  const { createExitRecord } = await import('../../lib/exit-analysis.js');
  const { upsertCandidate } = await import('../../lib/ae/candidate-upsert.js');
  const { candidateContact } = await import('../../lib/candidate-contact.js');
  const { finishEmployeeEmailChange, revokeEmployeeAccessForEmailChange, consumeEmployeeMagicToken } = await import('../../lib/employee-auth.js');
  const { __getMailMockLog, __resetMailMockLog } = await import('../../lib/mail.js');
  const { closeRateLimitRedis } = await import('../../lib/rate-limit.js');
  let companyId;
  try {
    companyId = (await query("INSERT INTO companies(name,slug) VALUES('Email lifecycle fixture','email-fixture-' || gen_random_uuid()::text) RETURNING id")).rows[0].id;
    const add = async (email, personal = null, status = 'candidate') => (await query('INSERT INTO candidates(company_id,full_name,email,personal_email,employment_status) VALUES($1,$2,$3,$4,$5) RETURNING id', [companyId, 'Email fixture', email, personal, status])).rows[0].id;
    const get = async id => (await query('SELECT *, email AS "currentEmail" FROM candidates WHERE id=$1', [id])).rows[0];
    const hire = async (candidateId, corporateEmail) => withTransaction(db => persistCandidateHire(db, { candidateId, companyId, startDate: '2026-10-22', inviteAccess: true, corporateEmail }));
    const candidateId = await add('personal@example.test');
    __resetMailMockLog();
    const hired = await hire(candidateId, '  WORK@EXAMPLE.TEST ');
    assert.equal((await get(candidateId)).personal_email, 'personal@example.test');
    assert.equal((await get(candidateId)).email, 'work@example.test');
    assert.equal((await get(candidateId)).employment_status, 'employee');
    assert.equal((await finishHireEmail({ candidateId, ...hired }, query)).inviteSent, true);
    assert.equal(__getMailMockLog().at(-1).to, 'work@example.test');
    assert.equal((await finishHireEmail({ candidateId, ...await hire(candidateId) }, query)), null, 'repeated transition does not reinvite');
    assert.equal(__getMailMockLog().length, 1);
    const same = await upsertCandidate({ companyId, fullName: 'Email fixture', email: 'personal@example.test' });
    assert.equal(same.candidateId, candidateId, 'an old personal invite keeps the same person');
    assert.equal((await get(candidateId)).email, 'work@example.test');
    assert.equal((await candidateContact(query, { companyId, email: 'personal@example.test' })).email, 'work@example.test');
    assert.equal(await candidateContact(query, { companyId: Number(companyId) + 99999, candidateId }), null, 'tenant isolation');

    // An existing invitation snapshot must not keep receiving reminders at the old address.
    const vacancyId = (await query("INSERT INTO vacancies(company_id,title,slug) VALUES($1,'Email vacancy','email-vacancy-' || gen_random_uuid()::text) RETURNING id", [companyId])).rows[0].id;
    const inviteId = (await query("INSERT INTO candidate_invites(company_id,vacancy_id,candidate_id,candidate_name,candidate_email,token,expires_at) VALUES($1,$2,$3,'Email fixture','personal@example.test',$4,NOW()+INTERVAL '1 day') RETURNING id", [companyId, vacancyId, candidateId, `email-reminder-${companyId}`])).rows[0].id;
    let sessionCompanyId = companyId;
    const deps = {
      candidateContact, query, queryRead: query,
      NextResponse: { json: Response.json }, cookies: async () => ({ get: () => ({ value: 'fixture-session' }) }), COOKIE_NAME: 'session',
      verifySessionWithCapabilities: async () => ({ companyId: sessionCompanyId }), requireCapability: () => true, isAdminRole: () => false, CAP: { VACANCIES_MANAGE: 'manage' },
      ensureActiveVacancyLinkToken: async () => 'fixture-vacancy-link', publicAppUrl: () => 'https://email-test.example',
      enqueueTransactionalMail: (await import('../../lib/mail.js')).enqueueTransactionalMail,
      buildCandidateChallengeInviteMail: () => ({ subject: 'Fixture reminder', text: 'Fixture only' }),
      checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'fixture-ip', localeFromRequest: () => 'pt-BR',
      ERR: (await import('../../lib/api-error-codes.js')).ERR,
      apiError: (_, code, status) => Response.json({ code }, { status }),
    };
    const context = vm.createContext({ console });
    const mod = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/vacancies/[id]/invites/[inviteId]/remind/route.js', import.meta.url), 'utf8'), { context });
    await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () { for (const [key, value] of Object.entries(deps)) this.setExport(key, value); }, { context }));
    await mod.evaluate();
    const remind = () => mod.namespace.POST({}, { params: { id: vacancyId, inviteId } });
    assert.equal((await remind()).status, 200);
    assert.equal(__getMailMockLog().at(-1).to, 'work@example.test');
    sessionCompanyId = Number(companyId) + 99999;
    const mailCount = __getMailMockLog().length;
    assert.equal((await remind()).status, 401);
    assert.equal(__getMailMockLog().length, mailCount, 'another company cannot send a reminder');
    sessionCompanyId = companyId;

    // Corporate email added later: preserve personal, revoke every old access path and issue a new invite even without previous portal access.
    const deferred = await add('later-personal@example.test');
    const deferredHire = await hire(deferred);
    assert.equal((await get(deferred)).personal_email, 'later-personal@example.test');
    assert.equal((await get(deferred)).email, 'later-personal@example.test');
    await finishHireEmail({ candidateId: deferred, ...deferredHire }, query);
    await query('UPDATE candidates SET password_hash=NULL,password_setup_token=NULL WHERE id=$1', [deferred]);
    const revoked = await withTransaction(async db => {
      await db.query('UPDATE candidates SET email=$2 WHERE id=$1', [deferred, 'later-work@example.test']);
      return revokeEmployeeAccessForEmailChange(db, { companyId, candidateId: deferred });
    });
    assert.equal(revoked.hadPortalAccess, false);
    assert.equal((await finishEmployeeEmailChange(query, { companyId, candidateId: deferred, revoked, inviteIfMissing: true })).inviteSent, true);
    assert.equal(__getMailMockLog().at(-1).to, 'later-work@example.test');

    await query("UPDATE candidates SET password_hash='old-hash' WHERE id=$1", [candidateId]);
    const oldVersion = (await get(candidateId)).session_version;
    const magic = `email-lifecycle-magic-${companyId}-1234567890`;
    await query("INSERT INTO employee_login_tokens(company_id,candidate_id,token,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')", [companyId, candidateId, magic]);
    await query("INSERT INTO employee_portal_tokens(company_id,candidate_id,token,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '1 day')", [companyId, candidateId, `email-lifecycle-portal-${companyId}-1234567890`]);
    __resetMailMockLog();
    const exited = await createExitRecord(null, { companyId, candidateId, exitDate: '2026-10-22', exitType: 'voluntary', exitReason: 'other' });
    assert.equal(exited.ok, true);
    const alumni = await get(candidateId);
    assert.equal(alumni.email, 'personal@example.test');
    assert.equal(alumni.employment_status, 'alumni');
    assert.equal(alumni.password_hash, null);
    assert.equal(alumni.password_setup_token, null);
    assert.ok(alumni.session_version > oldVersion);
    assert.equal((await consumeEmployeeMagicToken(query, { token: magic })).ok, false);
    assert.ok((await query('SELECT revoked_at FROM employee_portal_tokens WHERE candidate_id=$1', [candidateId])).rows[0].revoked_at);
    assert.equal(__getMailMockLog().length, 0, 'offboarding sends no portal invite to the personal address');
    assert.equal((await candidateContact(query, { companyId, candidateId })).email, 'personal@example.test');
    assert.equal((await remind()).status, 200);
    assert.equal(__getMailMockLog().at(-1).to, 'personal@example.test');
    assert.equal((await query('SELECT candidate_email FROM candidate_invites WHERE id=$1', [inviteId])).rows[0].candidate_email, 'personal@example.test', 'historical invite snapshot remains intact');


    const rehired = await rehireEmployee({ companyId, candidateId, rehireDate: '2026-10-22', corporateEmail: 'new-work@example.test', sendAccessInvite: true });
    assert.equal(rehired.ok, true);
    assert.equal(rehired.inviteSent, true);
    assert.equal((await get(candidateId)).email, 'new-work@example.test');
    assert.equal((await get(candidateId)).personal_email, 'personal@example.test');
    assert.equal(__getMailMockLog().filter(m => m.to === 'new-work@example.test').length, 1);
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM exit_records WHERE candidate_id=$1 AND rehired_at IS NOT NULL', [candidateId])).rows[0].n, 1);

    const preserved = await add('original@example.test', 'preferred-personal@example.test');
    await hire(preserved, 'preserved-work@example.test');
    assert.equal((await get(preserved)).personal_email, 'preferred-personal@example.test');
    assert.equal((await upsertCandidate({ companyId, candidateId: preserved, fullName: 'Original', email: 'original@example.test' })).candidateId, preserved);
    assert.equal((await get(preserved)).email, 'preserved-work@example.test');
    const invalid = await add('invalid-personal@example.test');
    await assert.rejects(hire(invalid, 'not-an-email'), { code: 'INVALID_EMAIL' });
    assert.equal((await get(invalid)).employment_status, 'candidate');
    await assert.rejects(hire(invalid, 'new-work@example.test'), { code: '23505' });
    assert.equal((await get(invalid)).personal_email, null, 'conflicting corporate address rolls back preservation and hire');

    const missing = await add('obsolete-corporate@example.test', null, 'employee');
    assert.equal((await createExitRecord(null, { companyId, candidateId: missing })).ok, true);
    assert.equal((await get(missing)).email, null, 'missing personal address never falls back to former corporate');
    const recovered = await add('legacy-work@example.test', null, 'employee');
    assert.equal((await createExitRecord(null, { companyId, candidateId: recovered, personalEmail: 'legacy-personal@example.test' })).ok, true);
    assert.equal((await get(recovered)).email, 'legacy-personal@example.test');
    assert.equal((await get(recovered)).personal_email, 'legacy-personal@example.test');
    const blocked = await add('blocked-work@example.test', 'personal@example.test', 'employee');
    // Another active contact already occupies this personal email.
    await add('personal@example.test');
    assert.equal((await createExitRecord(null, { companyId, candidateId: blocked })).errorCode, 'EMAIL_TAKEN');
    assert.equal((await get(blocked)).employment_status, 'employee');
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM exit_records WHERE candidate_id=$1', [blocked])).rows[0].n, 0, 'offboarding collision rolls back the exit record too');
    // Multi-company SaaS: the same personal email is three independent identities.
    const companies = [];
    for (const name of ['X', 'Y', 'Z']) companies.push((await query("INSERT INTO companies(name,slug) VALUES($1,'tenant-email-' || gen_random_uuid()::text) RETURNING id", [`Email tenant ${name}`])).rows[0].id);
    const [x, y, z] = companies;
    const apply = cid => upsertCandidate({ companyId: cid, fullName: 'Same person', email: 'shared-personal@example.test' });
    const xPerson = await apply(x);
    const yPerson = await apply(y);
    assert.notEqual(xPerson.candidateId, yPerson.candidateId);
    const area = (await query("INSERT INTO areas(key,label) VALUES('email-' || gen_random_uuid()::text,'Email fixture') RETURNING id")).rows[0].id;
    await query("INSERT INTO assessments(candidate_id,company_id,area_id,top_type,scores,pipeline_stage,rejection_reason) VALUES($1,$2,$3,1,'{}','rejected','profile_fit')", [xPerson.candidateId, x, area]);
    await withTransaction(db => persistCandidateHire(db, { candidateId: yPerson.candidateId, corporateEmail: 'person@y.example.test', startDate: '2023-10-22', inviteAccess: true }));
    assert.equal((await createExitRecord(null, { companyId: y, candidateId: yPerson.candidateId, exitDate: '2026-10-22' })).ok, true);
    const zPerson = await apply(z);
    await withTransaction(db => persistCandidateHire(db, { candidateId: zPerson.candidateId, corporateEmail: 'person@z.example.test', startDate: '2026-10-22', inviteAccess: true }));
    assert.equal(new Set([xPerson.candidateId, yPerson.candidateId, zPerson.candidateId]).size, 3);
    assert.equal((await get(xPerson.candidateId)).employment_status, 'candidate');
    assert.equal((await get(xPerson.candidateId)).email, 'shared-personal@example.test');
    assert.equal((await get(yPerson.candidateId)).employment_status, 'alumni');
    assert.equal((await get(yPerson.candidateId)).email, 'shared-personal@example.test');
    assert.equal((await get(zPerson.candidateId)).employment_status, 'employee');
    assert.equal((await get(zPerson.candidateId)).email, 'person@z.example.test');
    assert.equal((await candidateContact(query, { companyId: x, email: 'shared-personal@example.test' })).id, xPerson.candidateId);
    assert.equal((await candidateContact(query, { companyId: z, email: 'shared-personal@example.test' })).id, zPerson.candidateId);
    assert.equal(await candidateContact(query, { companyId: z, candidateId: xPerson.candidateId }), null);
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM assessments WHERE company_id=$1 AND candidate_id=$2', [z, xPerson.candidateId])).rows[0].n, 0);
    assert.equal((await query('SELECT pipeline_stage FROM assessments WHERE candidate_id=$1 AND company_id=$2', [xPerson.candidateId, x])).rows[0].pipeline_stage, 'rejected');
  } finally {
    // Fixtures stay in this fixed disposable database: immutable time-clock audit FKs forbid deletion.
    await pool.end();
    await closeRateLimitRedis();
  }
});
