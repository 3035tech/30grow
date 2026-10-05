/**
 * DTOV: B-2721 time clock MVP (schedule, punch flags, day list, CSV).
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import {
  TIME_PUNCH_FLAG,
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
  TIME_PUNCH_SOURCE,
} from '../../lib/domain-status.js';
import {
  createTimePunch,
  exportTimePunchesCsv,
  getCompanyTimeSchedule,
  getEmployeeTimeClockToday,
  listCompanyTimePunches,
  reviewTimePunch,
  suggestPunchFlag,
  upsertCompanyTimeSchedule,
} from '../../lib/people/time-clock.js';

async function main() {
  const co = await query(
    `SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`
  );
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = co.rows[0].id;

  const emp = await query(
    `SELECT id FROM candidates
     WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo'
     LIMIT 1`,
    [companyId]
  );
  assert.ok(emp.rowCount, 'demo collaborator missing');
  const candidateId = emp.rows[0].id;

  const hr = await query(
    `SELECT id AS "userId" FROM users
     WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE
     LIMIT 1`,
    [companyId]
  );
  const userId = hr.rows[0]?.userId || null;

  const late = suggestPunchFlag({
    punchKind: TIME_PUNCH_KIND.IN,
    punchedAt: new Date('2030-06-01T14:00:00.000Z'),
    schedule: {
      workdayStart: '09:00',
      workdayEnd: '18:00',
      lateGraceMinutes: 5,
      timezone: 'UTC',
    },
    todayPunches: [],
  });
  assert.equal(late, TIME_PUNCH_FLAG.LATE);

  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    breakMinutes: 60,
    timezone: 'America/Sao_Paulo',
    lateGraceMinutes: 10,
    updatedByUserId: userId,
  });
  assert.equal(sched.ok, true, sched.errorCode);
  assert.equal(sched.schedule.workdayStart, '09:00');

  const loaded = await getCompanyTimeSchedule({ query }, { companyId });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.schedule.timezone, 'America/Sao_Paulo');

  await query(`DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2`, [
    companyId,
    candidateId,
  ]);

  const punchIn = await createTimePunch({ query }, {
    companyId,
    candidateId,
    punchKind: TIME_PUNCH_KIND.IN,
    source: TIME_PUNCH_SOURCE.WEB,
    punchedAt: new Date().toISOString(),
    notes: 'dtov in',
  });
  assert.equal(punchIn.ok, true, punchIn.errorCode);

  const today = await getEmployeeTimeClockToday({ query }, { companyId, candidateId });
  assert.equal(today.ok, true, today.errorCode);
  assert.equal(today.nextKind, TIME_PUNCH_KIND.OUT);
  assert.equal(today.open, true);
  assert.ok(today.punches.some((p) => p.id === punchIn.punch.id));
  assert.equal(today.lastLocation, null, 'punch without coordinates has no last location');

  await query(`UPDATE employee_time_punches SET latitude = -23.55, longitude = -46.63 WHERE id = $1`, [punchIn.punch.id]);
  const located = await getEmployeeTimeClockToday({ query }, { companyId, candidateId });
  assert.deepEqual(
    { latitude: located.lastLocation?.latitude, longitude: located.lastLocation?.longitude, punchKind: located.lastLocation?.punchKind },
    { latitude: -23.55, longitude: -46.63, punchKind: TIME_PUNCH_KIND.IN }
  );

  const punchOut = await createTimePunch({ query }, {
    companyId,
    candidateId,
    punchKind: TIME_PUNCH_KIND.OUT,
    source: TIME_PUNCH_SOURCE.MANAGER,
    punchedAt: new Date().toISOString(),
    notes: 'dtov out',
    createdByUserId: userId,
  });
  assert.equal(punchOut.ok, true, punchOut.errorCode);
  assert.ok(
    punchOut.punch.flag === TIME_PUNCH_FLAG.MANUAL || punchOut.punch.flag === TIME_PUNCH_FLAG.EARLY_OUT
      || punchOut.punch.flag == null
      || punchOut.punch.flag === TIME_PUNCH_FLAG.ODD_PAIR
  );

  const reviewed = await reviewTimePunch({ query }, {
    companyId,
    punchId: punchIn.punch.id,
    reviewStatus: TIME_PUNCH_REVIEW.OK,
    reviewedByUserId: userId,
  });
  assert.equal(reviewed.ok, true, reviewed.errorCode);
  assert.equal(reviewed.punch.reviewStatus, TIME_PUNCH_REVIEW.OK);

  const listed = await listCompanyTimePunches({ query }, {
    companyId,
    day: today.day,
    limit: 50,
  });
  assert.equal(listed.ok, true, listed.errorCode);
  assert.ok(listed.items.some((p) => p.id === punchIn.punch.id));

  const csv = await exportTimePunchesCsv({ query }, { companyId, day: today.day });
  assert.equal(csv.ok, true, csv.errorCode);
  assert.ok(csv.csv.includes('punch_kind') || csv.csv.includes('kind'));
  assert.ok(csv.csv.includes(String(candidateId)));

  console.log('time-clock.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
