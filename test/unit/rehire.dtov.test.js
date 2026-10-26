import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool, query } from '../../lib/db.js';
import { closeRateLimitRedis } from '../../lib/identity/rate-limit.js';
import { __resetMailMockLog, __getMailMockLog } from '../../lib/mail.js';
import { createExitRecord, deleteExitRecord, getExitRecord, listExitRecords } from '../../lib/exit-analysis.js';
import { createEmployeeDirect, rehireEmployee } from '../../lib/recruiting/hire.js';
import { rosterScopeSqlPart } from '../../lib/roster-scope-sql.js';
import { ERR } from '../../lib/api-error-codes.js';
import { EMPLOYMENT_STATUS, ROSTER_SCOPE } from '../../lib/domain-status.js';

const dtov = process.env.DTOV === '1';
const prevEnv = { SMTP_MOCK: process.env.SMTP_MOCK, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
let person = null;

async function status(id) {
  const r = await query(`SELECT employment_status AS s, start_date::text AS sd FROM candidates WHERE id = $1`, [id]);
  return r.rows[0];
}

async function inRoster(scope) {
  const part = rosterScopeSqlPart(scope);
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM assessments ass
      WHERE ass.company_id = $1 AND ass.candidate_id = $2${part ? ` AND ${part}` : ''}`,
    [person.companyId, person.id]
  );
  return r.rows[0].n > 0;
}

async function exits() {
  const r = await query(
    `SELECT exit_date::text AS "exitDate", rehired_at::text AS "rehiredAt", rehired_by_user_id AS "by"
       FROM exit_records WHERE candidate_id = $1 ORDER BY exit_date, id`,
    [person.id]
  );
  return r.rows;
}

before(async () => {
  process.env.SMTP_MOCK = '1';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.rehire-test.example';
  if (!dtov) return;
  const r = await query(
    `SELECT c.id, c.company_id AS "companyId", LOWER(c.email) AS email, c.full_name AS name
       FROM candidates c
       JOIN assessments a ON a.candidate_id = c.id AND a.vacancy_id IS NULL AND a.company_id = c.company_id
      WHERE c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}' AND c.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM exit_records e WHERE e.candidate_id = c.id)
      ORDER BY c.id LIMIT 1`
  );
  person = r.rows[0];
  const u = await query(`SELECT id FROM users WHERE company_id = $1 ORDER BY id LIMIT 1`, [person.companyId]);
  person.actorId = u.rows[0]?.id || null;
});

after(async () => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  await pool.end();
  await closeRateLimitRedis();
});

describe('rehire former employees (DTOV)', { skip: !dtov }, () => {
  it('schema allows several stints but only one open exit', async () => {
    const idx = await query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_exit_records_open_candidate'`
    );
    assert.match(idx.rows[0].indexdef, /WHERE \(rehired_at IS NULL\)/);
    const uniq = await query(
      `SELECT COUNT(*)::int AS n FROM pg_constraint
        WHERE conrelid = 'exit_records'::regclass AND contype = 'u'`
    );
    assert.equal(uniq.rows[0].n, 0);
  });

  it('exit moves the person from internal to the alumni roster', async () => {
    assert.ok(person, 'fixture employee with company-link assessment');
    assert.equal(await inRoster(ROSTER_SCOPE.INTERNAL), true);
    const res = await createExitRecord(null, {
      companyId: person.companyId,
      candidateId: person.id,
      exitDate: '2026-01-10',
      exitType: 'voluntary',
      exitReason: 'better_offer',
    });
    assert.equal(res.ok, true);
    assert.equal((await status(person.id)).s, EMPLOYMENT_STATUS.ALUMNI);
    assert.equal(await inRoster(ROSTER_SCOPE.INTERNAL), false);
    assert.equal(await inRoster(ROSTER_SCOPE.ALUMNI), true);
    assert.equal(await inRoster(ROSTER_SCOPE.ALL), true);
  });

  it('rejects a return date before the exit', async () => {
    const res = await rehireEmployee({ companyId: person.companyId, candidateId: person.id, rehireDate: '2026-01-01' });
    assert.deepEqual(res, { ok: false, errorCode: ERR.REHIRE_BEFORE_EXIT });
    assert.equal((await status(person.id)).s, EMPLOYMENT_STATUS.ALUMNI);
  });

  it('rehire keeps the exit as history, restores employee and sends the invite', async () => {
    __resetMailMockLog();
    const res = await rehireEmployee({
      companyId: person.companyId,
      candidateId: person.id,
      rehireDate: '2026-03-01',
      rehiredByUserId: person.actorId,
      sendAccessInvite: true,
    });
    assert.equal(res.ok, true);
    assert.equal(res.rehireDate, '2026-03-01');
    assert.equal(res.inviteSent, true, `invite: ${res.inviteErrorCode}`);
    assert.equal(__getMailMockLog().at(-1)?.to, person.email);
    const st = await status(person.id);
    assert.equal(st.s, EMPLOYMENT_STATUS.EMPLOYEE);
    assert.equal(st.sd, '2026-03-01');
    assert.deepEqual(await exits(), [{ exitDate: '2026-01-10', rehiredAt: '2026-03-01', by: person.actorId }]);
    assert.equal(await inRoster(ROSTER_SCOPE.INTERNAL), true);
    assert.equal(await inRoster(ROSTER_SCOPE.ALUMNI), false);
  });

  it('cannot rehire someone who is not alumni; other tenants are isolated', async () => {
    const res = await rehireEmployee({ companyId: person.companyId, candidateId: person.id });
    assert.deepEqual(res, { ok: false, errorCode: ERR.NOT_ALUMNI });
    const other = await rehireEmployee({ companyId: person.companyId + 100000, candidateId: person.id });
    assert.deepEqual(other, { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND });
  });

  it('a second exit is recorded as a new stint; the open one is the current record', async () => {
    const res = await createExitRecord(null, {
      companyId: person.companyId,
      candidateId: person.id,
      exitDate: '2026-05-01',
      exitType: 'involuntary',
      exitReason: 'restructuring',
    });
    assert.equal(res.ok, true);
    assert.equal((await exits()).length, 2);
    const current = await getExitRecord(null, { companyId: person.companyId, candidateId: person.id });
    assert.equal(current.exitDate, '2026-05-01');
    assert.equal(current.rehiredAt, null);
    const listed = (await listExitRecords(null, { companyId: person.companyId }))
      .filter((r) => r.candidateId === person.id);
    assert.equal(listed.length, 2);
    assert.ok(listed.some((r) => r.rehiredAt === '2026-03-01'));
    const dup = await createExitRecord(null, {
      companyId: person.companyId,
      candidateId: person.id,
      exitDate: '2026-06-01',
      exitType: 'voluntary',
      exitReason: 'other',
    });
    assert.equal(dup.ok, false);
  });

  it('deleting a past stint does not change the current status', async () => {
    const old = await query(
      `SELECT id FROM exit_records WHERE candidate_id = $1 AND rehired_at IS NOT NULL`,
      [person.id]
    );
    const res = await deleteExitRecord(null, { companyId: person.companyId, exitRecordId: old.rows[0].id });
    assert.equal(res.ok, true);
    assert.equal((await status(person.id)).s, EMPLOYMENT_STATUS.ALUMNI);
  });

  it('including the same e-mail again closes the open exit instead of leaving it dangling', async () => {
    const res = await createEmployeeDirect({
      companyId: person.companyId,
      fullName: person.name,
      email: person.email,
      startDate: '2026-07-01',
    });
    assert.equal(res.ok, true);
    assert.equal(res.candidateId, person.id);
    assert.equal((await status(person.id)).s, EMPLOYMENT_STATUS.EMPLOYEE);
    const rows = await exits();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rehiredAt, '2026-07-01');
  });

  it('deleting a mistaken open exit restores the person (correction path)', async () => {
    const res = await createExitRecord(null, {
      companyId: person.companyId,
      candidateId: person.id,
      exitDate: '2026-08-01',
      exitType: 'voluntary',
      exitReason: 'other',
    });
    assert.equal(res.ok, true);
    const del = await deleteExitRecord(null, { companyId: person.companyId, exitRecordId: res.exitRecord.id });
    assert.equal(del.ok, true);
    assert.equal((await status(person.id)).s, EMPLOYMENT_STATUS.EMPLOYEE);
  });
});
