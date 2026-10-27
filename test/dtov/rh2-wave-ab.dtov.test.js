/**
 * DTOV proof — B-RH2-05/06/10: createEmployeeDirect, reopen check-in, prep bump.
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { createEmployeeDirect } from '../../lib/recruiting/hire.js';
import {
  ensureOnboardingCheckins,
  listOnboardingCheckins,
  updateOnboardingCheckin,
  reopenOnboardingCheckin,
} from '../../lib/people/onboarding-checkins.js';
import {
  getEmployeeOneOnOnePrep,
  submitEmployeeOneOnOnePrep,
} from '../../lib/employee/employee-one-on-one-prep.js';
import { ERR } from '../../lib/api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';

async function main() {
  const co = await query(
    `SELECT id FROM companies WHERE deleted = FALSE ORDER BY id ASC LIMIT 1`
  );
  assert.ok(co.rowCount > 0, 'need company in DTOV');
  const companyId = co.rows[0].id;
  const email = `rh2-direct-${Date.now()}@example.com`;

  const created = await createEmployeeDirect({
    companyId,
    fullName: 'RH2 Direct Hire',
    email,
    startDate: new Date().toISOString().slice(0, 10),
    sendAccessInvite: false,
    locale: 'pt-BR',
  });
  assert.equal(created.ok, true, created.errorCode);
  assert.ok(created.candidateId);

  const dup = await createEmployeeDirect({
    companyId,
    fullName: 'RH2 Direct Hire',
    email,
    sendAccessInvite: false,
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.errorCode, ERR.EMPLOYEE_ALREADY_EXISTS);

  const status = await query(
    `SELECT employment_status AS "employmentStatus" FROM candidates WHERE id = $1`,
    [created.candidateId]
  );
  assert.equal(status.rows[0].employmentStatus, EMPLOYMENT_STATUS.EMPLOYEE);

  await ensureOnboardingCheckins(query, { companyId, candidateId: created.candidateId });
  let items = await listOnboardingCheckins(query, { companyId, candidateId: created.candidateId });
  assert.ok(items.length >= 3, 'expect D30/60/90');

  const first = items[0];
  const done = await updateOnboardingCheckin(query, {
    companyId,
    candidateId: created.candidateId,
    checkinId: first.id,
    status: 'done',
    outcome: 'continue',
    notes: '',
    completedByUserId: null,
  });
  assert.equal(done.ok, true, done.errorCode);

  const reopened = await reopenOnboardingCheckin(query, {
    companyId,
    candidateId: created.candidateId,
    checkinId: first.id,
  });
  assert.equal(reopened.ok, true, reopened.errorCode);
  assert.equal(reopened.item.status, 'pending');
  assert.equal(reopened.item.completedAt, null);

  const prep1 = await submitEmployeeOneOnOnePrep(query, {
    companyId,
    candidateId: created.candidateId,
    noteToManager: 'Primeira prep',
  });
  assert.equal(prep1.ok, true, prep1.errorCode);
  assert.ok(prep1.preparedAt);
  const t1 = new Date(prep1.preparedAt).getTime();

  await new Promise((r) => setTimeout(r, 1100));

  const prep2 = await submitEmployeeOneOnOnePrep(query, {
    companyId,
    candidateId: created.candidateId,
    noteToManager: 'Atualizei a prep',
  });
  assert.equal(prep2.ok, true, prep2.errorCode);
  const t2 = new Date(prep2.preparedAt).getTime();
  assert.ok(t2 > t1, 'preparedAt must bump on update');
  assert.equal(prep2.noteToManager, 'Atualizei a prep');

  await new Promise((r) => setTimeout(r, 1100));
  const prep3 = await submitEmployeeOneOnOnePrep(query, {
    companyId,
    candidateId: created.candidateId,
    noteToManager: '',
  });
  assert.equal(prep3.ok, true, prep3.errorCode);
  assert.ok(new Date(prep3.preparedAt).getTime() > t2, 'empty note still bumps preparedAt');
  assert.equal(prep3.noteToManager, 'Atualizei a prep', 'empty note keeps previous text');

  const got = await getEmployeeOneOnOnePrep(query, {
    companyId,
    candidateId: created.candidateId,
  });
  assert.equal(got.ok, true);
  assert.equal(got.noteToManager, 'Atualizei a prep');

  console.log('rh2-wave-ab.dtov: ok');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  });
