/**
 * DTOV: manager time clock (people list, mirror, adjust void+insert, justification,
 * period closure lock/unlock, balances with org info).
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  TIME_DAY_JUSTIFICATION,
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
  TIME_PUNCH_SOURCE,
} from '../../lib/domain-status.js';
import {
  createTimePunch,
  isoDayInTz,
  listCompanyTimePunches,
  reviewTimePunch,
  upsertCompanyTimeSchedule,
} from '../../lib/people/time-clock.js';
import {
  addDaysIso,
  adjustTimeDay,
  cancelTimeClockClosure,
  createTimeClockClosure,
  deleteTimeDayJustification,
  getEmployeeTimeMirror,
  isWorkdayIso,
  listTimeClockClosures,
  listTimeClockPeople,
  upsertTimeDayJustification,
} from '../../lib/people/time-clock-manager.js';
import { listHourBankBalances } from '../../lib/people/hour-bank.js';

const TZ = 'America/Sao_Paulo';

async function localTs(day, hm) {
  const r = await query(`SELECT (($1::date + $2::time) AT TIME ZONE $3) AS at`, [day, hm, TZ]);
  return new Date(r.rows[0].at).toISOString();
}

function pastWorkday(offset) {
  let day = addDaysIso(isoDayInTz(new Date(), TZ), -offset);
  while (!isWorkdayIso(day)) day = addDaysIso(day, -1);
  return day;
}

async function main() {
  const co = await query(
    `SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`
  );
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = Number(co.rows[0].id);
  const emp = await query(
    `SELECT id FROM candidates WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo' LIMIT 1`,
    [companyId]
  );
  const candidateId = Number(emp.rows[0].id);
  const hr = await query(
    `SELECT id FROM users WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  const userId = hr.rows[0]?.id ? Number(hr.rows[0].id) : null;

  await query(
    `UPDATE time_clock_closures SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'dtov reset'
     WHERE company_id = $1 AND status = 'closed'`,
    [companyId]
  );
  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    breakMinutes: 60,
    lateGraceMinutes: 10,
    timezone: TZ,
  });
  assert.equal(sched.ok, true, sched.errorCode);

  const workDay = pastWorkday(12);
  const otherDay = pastWorkday(20);
  for (const d of [workDay, otherDay]) {
    await query(
      `DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2
         AND punched_at >= ($3::timestamp AT TIME ZONE $4)
         AND punched_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)`,
      [companyId, candidateId, d, TZ]
    );
    await query(
      `DELETE FROM employee_time_day_justifications WHERE company_id = $1 AND candidate_id = $2 AND work_on = $3::date`,
      [companyId, candidateId, d]
    );
  }

  const ids = [];
  for (const [hm, kind] of [['09:00', 'in'], ['12:00', 'out'], ['13:00', 'in'], ['17:00', 'out']]) {
    const r = await createTimePunch({ query }, {
      companyId,
      candidateId,
      punchKind: kind,
      source: TIME_PUNCH_SOURCE.WEB,
      punchedAt: await localTs(workDay, hm),
    });
    assert.equal(r.ok, true, r.errorCode);
    ids.push(r.punch.id);
  }

  const people = await listTimeClockPeople({ query }, { companyId, q: 'colaborador' });
  assert.equal(people.ok, true, people.errorCode);
  assert.ok(people.total >= 1);
  assert.ok(people.items.some((p) => p.candidateId === candidateId));
  assert.ok('orgUnitPath' in people.items[0] && 'jobRoleName' in people.items[0]);

  const from = addDaysIso(workDay, -5);
  const to = addDaysIso(workDay, 2);
  let mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from, to });
  assert.equal(mirror.ok, true, mirror.errorCode);
  assert.equal(mirror.days.length, 8);
  let day = mirror.days.find((d) => d.day === workDay);
  assert.equal(day.workedMinutes, 420);
  assert.equal(day.missingMinutes, 60);
  assert.equal(day.occurrence, TIME_DAY_OCCURRENCE.REVIEW, '17:00 out is flagged early_out');

  const huge = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: addDaysIso(to, -200), to });
  assert.equal(huge.ok, true);
  assert.ok(huge.days.length <= 62, 'mirror period capped');

  const adj = await adjustTimeDay({
    companyId,
    candidateId,
    day: workDay,
    voidPunchIds: [ids[3]],
    add: [{ time: '18:00', kind: TIME_PUNCH_KIND.OUT }],
    reason: 'Esqueceu de bater a saída correta',
    userId,
  });
  assert.equal(adj.ok, true, adj.errorCode);
  assert.equal(adj.voided, 1);
  assert.equal(adj.insertedIds.length, 1);

  mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from, to });
  day = mirror.days.find((d) => d.day === workDay);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.missingMinutes, 0);
  assert.equal(day.voidedCount, 1);
  const voided = day.punches.find((p) => p.id === ids[3]);
  assert.ok(voided.voidedAt && voided.voidReason);
  const added = day.punches.find((p) => p.id === adj.insertedIds[0]);
  assert.equal(added.source, TIME_PUNCH_SOURCE.MANAGER);

  const listed = await listCompanyTimePunches({ query }, { companyId, day: workDay, limit: 80 });
  assert.ok(!listed.items.some((p) => p.id === ids[3]), 'voided punch excluded from day list');

  const badAdj = await adjustTimeDay({ companyId, candidateId, day: workDay, voidPunchIds: [ids[3]], reason: 'Tentar remover novamente', userId });
  assert.equal(badAdj.ok, false);
  assert.equal(badAdj.errorCode, ERR.NOT_FOUND, 'already voided cannot be voided twice');
  const noReason = await adjustTimeDay({ companyId, candidateId, day: workDay, add: [{ time: '19:00', kind: 'in' }], reason: '', userId });
  assert.equal(noReason.errorCode, ERR.INVALID_DATA);

  const pre = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: otherDay, to: otherDay });
  assert.ok(
    [TIME_DAY_OCCURRENCE.ABSENCE, TIME_DAY_OCCURRENCE.REST].includes(pre.days[0].occurrence),
    `unexpected ${pre.days[0].occurrence}`
  );
  const just = await upsertTimeDayJustification({
    companyId,
    candidateId,
    day: otherDay,
    reason: TIME_DAY_JUSTIFICATION.MEDICAL_CERTIFICATE,
    note: 'Atestado 1 dia',
    userId,
  });
  assert.equal(just.ok, true, just.errorCode);
  const mirrorJ = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: otherDay, to: otherDay });
  assert.equal(mirrorJ.days[0].occurrence, TIME_DAY_OCCURRENCE.JUSTIFIED);
  assert.equal(mirrorJ.days[0].missingMinutes, 0);
  const future = await upsertTimeDayJustification({
    companyId, candidateId, day: addDaysIso(isoDayInTz(new Date(), TZ), 3), reason: TIME_DAY_JUSTIFICATION.HOLIDAY, userId,
  });
  assert.equal(future.errorCode, ERR.INVALID_DATE);

  const closure = await createTimeClockClosure({
    companyId,
    periodStart: addDaysIso(workDay, -1),
    periodEnd: addDaysIso(workDay, 1),
    userId,
  });
  assert.equal(closure.ok, true, closure.errorCode);

  const overlap = await createTimeClockClosure({ companyId, periodStart: workDay, periodEnd: workDay, userId });
  assert.equal(overlap.errorCode, ERR.TIME_CLOCK_CLOSURE_OVERLAP);
  const futureClose = await createTimeClockClosure({
    companyId, periodStart: isoDayInTz(new Date(), TZ), periodEnd: isoDayInTz(new Date(), TZ), userId,
  });
  assert.equal(futureClose.errorCode, ERR.TIME_CLOCK_CLOSURE_FUTURE);

  const lockedAdj = await adjustTimeDay({
    companyId, candidateId, day: workDay, add: [{ time: '19:00', kind: 'in' }], reason: 'Teste de período fechado', userId,
  });
  assert.equal(lockedAdj.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedJust = await upsertTimeDayJustification({
    companyId, candidateId, day: workDay, reason: TIME_DAY_JUSTIFICATION.OTHER, userId,
  });
  assert.equal(lockedJust.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedManual = await createTimePunch({ query }, {
    companyId, candidateId, punchKind: 'in', source: TIME_PUNCH_SOURCE.MANAGER, punchedAt: await localTs(workDay, '20:00'),
  });
  assert.equal(lockedManual.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedReview = await reviewTimePunch({ query }, {
    companyId, punchId: ids[0], reviewStatus: TIME_PUNCH_REVIEW.OK, reviewedByUserId: userId,
  });
  assert.equal(lockedReview.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedMirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from, to });
  assert.equal(lockedMirror.days.find((d) => d.day === workDay).locked, true);
  assert.equal(lockedMirror.days.find((d) => d.day === from).locked, false);

  const list = await listTimeClockClosures({ query }, { companyId, q: String(closure.id) });
  assert.equal(list.ok, true);
  assert.equal(list.items[0]?.id, closure.id);
  assert.equal(list.items[0].status, 'closed');

  const cancelled = await cancelTimeClockClosure({ companyId, closureId: closure.id, reason: 'Correção de marcação', userId });
  assert.equal(cancelled.ok, true, cancelled.errorCode);
  const again = await cancelTimeClockClosure({ companyId, closureId: closure.id, reason: 'de novo', userId });
  assert.equal(again.errorCode, ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE);
  const otherTenant = await cancelTimeClockClosure({ companyId: companyId + 999999, closureId: closure.id, reason: 'x y z', userId });
  assert.equal(otherTenant.errorCode, ERR.NOT_FOUND);

  const unlocked = await upsertTimeDayJustification({
    companyId, candidateId, day: workDay, reason: TIME_DAY_JUSTIFICATION.OTHER, userId,
  });
  assert.equal(unlocked.ok, true, unlocked.errorCode);
  const removed = await deleteTimeDayJustification({ companyId, candidateId, day: workDay });
  assert.equal(removed.ok, true, removed.errorCode);
  await deleteTimeDayJustification({ companyId, candidateId, day: otherDay });

  const balances = await listHourBankBalances({ query }, { companyId, limit: 5, offset: 0 });
  assert.equal(balances.ok, true, balances.errorCode);
  assert.ok(Number.isFinite(balances.total));
  assert.ok(balances.items.length <= 5);
  if (balances.items[0]) assert.ok('orgUnitPath' in balances.items[0]);

  console.log('time-clock-manager.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
