/**
 * DTOV: collaborator time clock requests (adjustment / excuse) → manager approve or
 * reject → punches and day balance updated; duplicates, stale voids, closures, cancel.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_SOURCE,
  TIME_REQUEST_DECISION,
  TIME_REQUEST_KIND,
  TIME_REQUEST_STATUS,
} from '../../lib/domain-status.js';
import { createTimePunch, isoDayInTz, upsertCompanyTimeSchedule } from '../../lib/people/time-clock.js';
import {
  addDaysIso,
  adjustTimeDay,
  cancelTimeClockClosure,
  createTimeClockClosure,
  getEmployeeTimeMirror,
  isWorkdayIso,
} from '../../lib/people/time-clock-manager.js';
import {
  cancelTimeRequest,
  countPendingTimeRequests,
  createTimeRequest,
  decideTimeRequest,
  getEmployeeTimeHistory,
  getTimeRequestDetail,
  listTimeRequests,
} from '../../lib/people/time-clock-requests.js';

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

async function resetDay(companyId, candidateId, day) {
  await query(
    `DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2
       AND punched_at >= ($3::timestamp AT TIME ZONE $4)
       AND punched_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)`,
    [companyId, candidateId, day, TZ]
  );
  await query(
    `DELETE FROM employee_time_day_justifications WHERE company_id = $1 AND candidate_id = $2 AND work_on = $3::date`,
    [companyId, candidateId, day]
  );
  await query(
    `DELETE FROM employee_time_requests WHERE company_id = $1 AND candidate_id = $2 AND work_on = $3::date`,
    [companyId, candidateId, day]
  );
}

async function punchDay(companyId, candidateId, day, pairs) {
  const ids = [];
  for (const [hm, kind] of pairs) {
    const r = await createTimePunch({ query }, {
      companyId, candidateId, punchKind: kind, source: TIME_PUNCH_SOURCE.WEB, punchedAt: await localTs(day, hm),
    });
    assert.equal(r.ok, true, r.errorCode);
    ids.push(r.punch.id);
  }
  return ids;
}

async function dayOf(companyId, candidateId, day) {
  const m = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: day, to: day });
  assert.equal(m.ok, true, m.errorCode);
  return m.days[0];
}

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing: run dtov:reset');
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
    companyId, workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, lateGraceMinutes: 10, timezone: TZ,
  });
  assert.equal(sched.ok, true, sched.errorCode);

  const adjDay = pastWorkday(5);
  const excDay = pastWorkday(9);
  const lockDay = pastWorkday(15);
  for (const d of [adjDay, excDay, lockDay]) await resetDay(companyId, candidateId, d);

  // Adjustment: forgot to punch back in after lunch and the out was wrong.
  const ids = await punchDay(companyId, candidateId, adjDay, [['09:00', 'in'], ['12:00', 'out'], ['17:00', 'out']]);
  let day = await dayOf(companyId, candidateId, adjDay);
  assert.equal(day.occurrence, TIME_DAY_OCCURRENCE.INCOMPLETE);

  const shortWhy = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.ADJUSTMENT, day: adjDay, justification: 'x', add: [{ time: '13:00', kind: 'in' }],
  });
  assert.equal(shortWhy.errorCode, ERR.INVALID_DATA);
  const future = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.EXCUSE, day: addDaysIso(isoDayInTz(new Date(), TZ), 2),
    justification: 'consulta', excuseReason: 'day_off',
  });
  assert.equal(future.errorCode, ERR.INVALID_DATE);

  const created = await createTimeRequest({
    companyId,
    candidateId,
    kind: TIME_REQUEST_KIND.ADJUSTMENT,
    day: adjDay,
    justification: 'Esqueci a volta do almoço e a saída foi às 18h',
    voidPunchIds: [ids[2]],
    add: [{ time: '13:00', kind: 'in' }, { time: '18:00', kind: 'out' }],
  });
  assert.equal(created.ok, true, created.errorCode);
  const reqId = created.item.id;
  assert.equal(created.item.status, TIME_REQUEST_STATUS.PENDING);
  assert.equal(created.item.changes.length, 3);
  assert.ok(created.item.changes.some((c) => c.action === 'void' && c.time === '17:00'), 'void shows original time');

  const dup = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.ADJUSTMENT, day: adjDay, justification: 'outra vez',
    add: [{ time: '13:00', kind: 'in' }],
  });
  assert.equal(dup.errorCode, ERR.TIME_REQUEST_DUPLICATE);

  day = await dayOf(companyId, candidateId, adjDay);
  assert.equal(day.workedMinutes, 180, 'nothing applied before approval');
  assert.equal(day.requests.length, 1);

  const history = await getEmployeeTimeHistory({ query }, { companyId, candidateId, from: adjDay, to: adjDay });
  assert.equal(history.ok, true, history.errorCode);
  const hDay = history.days[0];
  assert.equal(hDay.requests[0].id, reqId);
  assert.ok(hDay.punches.every((p) => !('latitude' in p) && !('reviewedByName' in p)), 'history is sanitized');
  assert.ok(history.totals.pendingRequests >= 1);

  assert.ok((await countPendingTimeRequests({ query }, { companyId })) >= 1);
  const queue = await listTimeRequests({ query }, { companyId, q: 'colaborador' });
  assert.equal(queue.ok, true, queue.errorCode);
  assert.ok(queue.items.some((r) => r.id === reqId));
  const detail = await getTimeRequestDetail({ query }, { companyId, id: reqId });
  assert.equal(detail.ok, true, detail.errorCode);
  assert.equal(detail.day.day, adjDay);
  const otherTenant = await getTimeRequestDetail({ query }, { companyId: companyId + 999999, id: reqId });
  assert.equal(otherTenant.errorCode, ERR.NOT_FOUND);

  const approved = await decideTimeRequest({ companyId, id: reqId, decision: TIME_REQUEST_DECISION.APPROVE, userId });
  assert.equal(approved.ok, true, approved.errorCode);
  assert.equal(approved.status, TIME_REQUEST_STATUS.APPROVED);
  day = await dayOf(companyId, candidateId, adjDay);
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.missingMinutes, 0);
  assert.equal(day.voidedCount, 1);
  assert.ok(day.punches.filter((p) => !p.voidedAt && p.source === TIME_PUNCH_SOURCE.MANAGER).length === 2);
  const again = await decideTimeRequest({ companyId, id: reqId, decision: TIME_REQUEST_DECISION.REJECT, userId });
  assert.equal(again.errorCode, ERR.TIME_REQUEST_NOT_PENDING);

  // Stale: the punch to void was already voided by the manager after the request.
  const active = day.punches.filter((p) => !p.voidedAt);
  const stale = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.ADJUSTMENT, day: adjDay, justification: 'remover a saída',
    voidPunchIds: [active[active.length - 1].id],
  });
  assert.equal(stale.ok, true, stale.errorCode);
  const mgr = await adjustTimeDay({
    companyId, candidateId, day: adjDay, voidPunchIds: [active[active.length - 1].id],
    add: [{ time: '18:05', kind: TIME_PUNCH_KIND.OUT }], reason: 'RH corrigiu', userId,
  });
  assert.equal(mgr.ok, true, mgr.errorCode);
  const staleDecide = await decideTimeRequest({ companyId, id: stale.item.id, decision: TIME_REQUEST_DECISION.APPROVE, userId });
  assert.equal(staleDecide.errorCode, ERR.TIME_REQUEST_STALE);
  const voidedTwice = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.ADJUSTMENT, day: adjDay, justification: 'remover de novo',
    voidPunchIds: [ids[2]],
  });
  assert.ok([ERR.TIME_REQUEST_STALE, ERR.TIME_REQUEST_DUPLICATE].includes(voidedTwice.errorCode));
  const rejected = await decideTimeRequest({
    companyId, id: stale.item.id, decision: TIME_REQUEST_DECISION.REJECT, note: 'Já corrigido pelo RH', userId,
  });
  assert.equal(rejected.ok, true, rejected.errorCode);
  const afterReject = await getTimeRequestDetail({ query }, { companyId, id: stale.item.id });
  assert.equal(afterReject.item.status, TIME_REQUEST_STATUS.REJECTED);
  assert.equal(afterReject.item.decisionNote, 'Já corrigido pelo RH');

  // Partial excuse: left at 15:00 for a medical appointment.
  await punchDay(companyId, candidateId, excDay, [['09:00', 'in'], ['12:00', 'out'], ['13:00', 'in'], ['15:00', 'out']]);
  day = await dayOf(companyId, candidateId, excDay);
  assert.equal(day.missingMinutes, 180);
  const badInterval = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.EXCUSE, day: excDay, justification: 'consulta',
    excuseReason: 'medical_certificate', excuseStart: '18:00', excuseEnd: '15:00',
  });
  assert.equal(badInterval.errorCode, ERR.INVALID_DATA);
  const exc = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.EXCUSE, day: excDay, justification: 'Consulta médica às 15h30',
    excuseReason: 'medical_certificate', excuseStart: '15:00', excuseEnd: '17:00',
  });
  assert.equal(exc.ok, true, exc.errorCode);
  const cancelled = await cancelTimeRequest({ companyId, candidateId, id: exc.item.id });
  assert.equal(cancelled.ok, true, cancelled.errorCode);
  const cancelAgain = await cancelTimeRequest({ companyId, candidateId, id: exc.item.id });
  assert.equal(cancelAgain.errorCode, ERR.TIME_REQUEST_NOT_PENDING);
  const cancelOther = await cancelTimeRequest({ companyId, candidateId: candidateId + 999999, id: exc.item.id });
  assert.equal(cancelOther.errorCode, ERR.NOT_FOUND);
  day = await dayOf(companyId, candidateId, excDay);
  assert.equal(day.requests.length, 0, 'cancelled requests are hidden from the mirror');

  const exc2 = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.EXCUSE, day: excDay, justification: 'Consulta médica às 15h30',
    excuseReason: 'medical_certificate', excuseStart: '15:00', excuseEnd: '17:00',
  });
  assert.equal(exc2.ok, true, exc2.errorCode);
  const excOk = await decideTimeRequest({ companyId, id: exc2.item.id, decision: TIME_REQUEST_DECISION.APPROVE, userId });
  assert.equal(excOk.ok, true, excOk.errorCode);
  day = await dayOf(companyId, candidateId, excDay);
  assert.equal(day.justification.excusedStart, '15:00');
  assert.equal(day.justification.excusedEnd, '17:00');
  assert.equal(day.justification.sourceRequestId, exc2.item.id);
  assert.equal(day.missingMinutes, 60, 'only the excused interval is discounted');

  // Closed period: requests cannot be created and pending ones cannot be approved.
  await punchDay(companyId, candidateId, lockDay, [['09:00', 'in'], ['18:00', 'out']]);
  const pendingLock = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.EXCUSE, day: lockDay, justification: 'folga', excuseReason: 'day_off',
  });
  assert.equal(pendingLock.ok, true, pendingLock.errorCode);
  const closure = await createTimeClockClosure({ companyId, periodStart: lockDay, periodEnd: lockDay, userId });
  assert.equal(closure.ok, true, closure.errorCode);
  const lockedCreate = await createTimeRequest({
    companyId, candidateId, kind: TIME_REQUEST_KIND.ADJUSTMENT, day: lockDay, justification: 'ajuste',
    add: [{ time: '12:00', kind: 'out' }],
  });
  assert.equal(lockedCreate.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedApprove = await decideTimeRequest({ companyId, id: pendingLock.item.id, decision: TIME_REQUEST_DECISION.APPROVE, userId });
  assert.equal(lockedApprove.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedReject = await decideTimeRequest({ companyId, id: pendingLock.item.id, decision: TIME_REQUEST_DECISION.REJECT, userId });
  assert.equal(lockedReject.ok, true, 'rejecting does not touch the closed day');
  const unlocked = await cancelTimeClockClosure({ companyId, closureId: closure.id, reason: 'fim do teste', userId });
  assert.equal(unlocked.ok, true, unlocked.errorCode);

  for (const d of [adjDay, excDay, lockDay]) await resetDay(companyId, candidateId, d);
  console.log('time-clock-requests.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
