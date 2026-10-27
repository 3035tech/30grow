/**
 * DTOV — employee profile + notifications smoke.
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { EMPLOYMENT_STATUS } from '../../lib/domain-status.js';
import { closeRateLimitRedis } from '../../lib/identity/rate-limit.js';
import {
  changeEmployeePassword,
  getEmployeeProfile,
  updateEmployeeProfile,
} from '../../lib/employee/employee-profile.js';
import {
  EMPLOYEE_NOTIF,
  listCandidateNotifications,
  notifyCandidate,
} from '../../lib/employee/employee-notifications.js';
import {
  completeEmployeePasswordSetup,
  issueEmployeePasswordInvite,
} from '../../lib/employee/employee-auth.js';
import { loadEmployeeSessionVersion } from '../../lib/employee/employee-session-revocation.js';

async function main() {
  const emp = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId", c.email
     FROM candidates c
     WHERE c.employment_status = $1 AND c.email IS NOT NULL AND TRIM(c.email) <> ''
     ORDER BY c.id ASC LIMIT 1`,
    [EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emp.rowCount > 0);
  const person = emp.rows[0];

  await issueEmployeePasswordInvite(query, {
    candidateId: person.candidateId,
    companyId: person.companyId,
    requireMail: false,
  });
  const tok = await query(
    `SELECT password_setup_token AS token FROM candidates WHERE id = $1`,
    [person.candidateId]
  );
  await completeEmployeePasswordSetup(query, {
    token: tok.rows[0].token,
    password: 'ColabChrome!2026',
  });

  const profile = await getEmployeeProfile(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(profile.ok, true);

  const updated = await updateEmployeeProfile(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    patch: { phone: '11999990000', city: 'São Paulo', state: 'SP' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.person.city, 'São Paulo');

  // Saved language survives as-is (fr/de were collapsed to en) and reaches the login session loader.
  const fr = await updateEmployeeProfile(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    patch: { preferredLocale: 'fr-FR' },
  });
  assert.equal(fr.ok, true);
  assert.equal(fr.person.preferredLocale, 'fr-FR');
  const live = await loadEmployeeSessionVersion(person.candidateId, person.companyId);
  assert.equal(live.preferredLocale, 'fr-FR');
  await query(`UPDATE candidates SET preferred_locale = NULL WHERE id = $1`, [person.candidateId]);
  const unset = await getEmployeeProfile(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(unset.person.preferredLocale, null);

  const pwd = await changeEmployeePassword(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    currentPassword: 'ColabChrome!2026',
    newPassword: 'ColabChrome!2027',
  });
  assert.equal(pwd.ok, true);

  const n = await notifyCandidate(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
    type: EMPLOYEE_NOTIF.LMS_ENROLLED,
    payload: { courseTitle: 'DTOV Course' },
    dedupeKey: `dtov-lms:${person.candidateId}:${Date.now()}`,
  });
  assert.ok(n.inserted >= 1);

  const list = await listCandidateNotifications(query, {
    companyId: person.companyId,
    candidateId: person.candidateId,
  });
  assert.equal(list.ok, true);
  assert.ok(list.unreadCount >= 1);

  console.log('employee-chrome.dtov.test.js OK');
  await closeRateLimitRedis();
  await pool.end().catch(() => {});
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeRateLimitRedis();
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
