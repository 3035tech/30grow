/**
 * DTOV: per-person closure summary (migration 147) + collaborator sign / dispute of the
 * mirror, CSV, notifications, cancelled closure and backfill for older closures.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import { TIME_CLOCK_ACK_STATUS, TIME_PUNCH_SOURCE } from '../../lib/domain-status.js';
import { EMPLOYEE_NOTIF } from '../../lib/employee-notification-catalog.js';
import { NOTIF } from '../../lib/manager-notification-catalog.js';
import { createTimePunch, isoDayInTz, upsertCompanyTimeSchedule } from '../../lib/people/time-clock.js';
import {
  addDaysIso,
  cancelTimeClockClosure,
  createTimeClockClosure,
  isWorkdayIso,
  listTimeClockClosures,
} from '../../lib/people/time-clock-manager.js';
import {
  TIME_CLOCK_ACK_CONSENT_VERSION,
  acknowledgeClosure,
  closureSnapshotHash,
  exportClosurePeopleCsv,
  generateClosurePeople,
  listClosurePeople,
  listEmployeeClosureAcks,
  notifyClosureDisputed,
  notifyClosureMirrorsReady,
} from '../../lib/people/time-clock-closure-people.js';

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

async function cleanDay(companyId, candidateId, day) {
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
}

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
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
  const prevStart = await query(`SELECT start_date FROM candidates WHERE id = $1`, [candidateId]);
  await query(`UPDATE candidates SET start_date = '2020-01-01' WHERE id = $1 AND company_id = $2`, [candidateId, companyId]);
  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    breakMinutes: 60,
    lateGraceMinutes: 10,
    timezone: TZ,
  });
  assert.equal(sched.ok, true, sched.errorCode);

  const day1 = pastWorkday(45);
  const day2 = pastWorkday(55);
  const day3 = pastWorkday(65);
  for (const d of [day1, day2, day3]) await cleanDay(companyId, candidateId, d);
  for (const [hm, kind] of [['09:00', 'in'], ['18:00', 'out']]) {
    const r = await createTimePunch({ query }, {
      companyId,
      candidateId,
      punchKind: kind,
      source: TIME_PUNCH_SOURCE.WEB,
      punchedAt: await localTs(day1, hm),
    });
    assert.equal(r.ok, true, r.errorCode);
  }

  // Closing freezes per-person totals in the same transaction.
  const c1 = await createTimeClockClosure({ companyId, periodStart: day1, periodEnd: day1, userId });
  assert.equal(c1.ok, true, c1.errorCode);
  assert.ok(c1.summaryCount >= 1);
  assert.ok(c1.summaryCandidateIds.includes(candidateId));

  const list = await listClosurePeople({ query }, { companyId, closureId: c1.id, q: 'colaborador' });
  assert.equal(list.ok, true, list.errorCode);
  const row = list.items.find((p) => p.candidateId === candidateId);
  assert.ok(row, 'person row missing');
  assert.equal(row.workedMinutes, 540);
  assert.equal(row.expectedMinutes, 480);
  assert.equal(row.extraMinutes, 60);
  assert.equal(row.missingMinutes, 0);
  assert.equal(row.workdays, 1);
  assert.equal(row.ackStatus, TIME_CLOCK_ACK_STATUS.PENDING);
  assert.equal(row.snapshotHash, closureSnapshotHash({
    closureId: c1.id,
    candidateId,
    periodStart: day1,
    periodEnd: day1,
    totals: row,
  }));
  assert.equal(list.counts.total, c1.summaryCount);
  assert.ok(list.counts.pending >= 1);
  const signedOnly = await listClosurePeople({ query }, { companyId, closureId: c1.id, status: TIME_CLOCK_ACK_STATUS.SIGNED });
  assert.equal(signedOnly.items.length, 0);
  const foreign = await listClosurePeople({ query }, { companyId: companyId + 99999, closureId: c1.id });
  assert.equal(foreign.errorCode, ERR.NOT_FOUND);

  const csv = await exportClosurePeopleCsv({ query }, { companyId, closureId: c1.id });
  assert.equal(csv.ok, true);
  const lines = csv.csv.trim().split('\n');
  assert.ok(lines[0].startsWith('closure_id,period_start'));
  assert.ok(lines.some((l) => l.includes(`,${candidateId},`) && l.includes(row.snapshotHash)));

  const mine = await listEmployeeClosureAcks({ query }, { companyId, candidateId });
  assert.equal(mine.ok, true);
  assert.equal(mine.consentVersion, TIME_CLOCK_ACK_CONSENT_VERSION);
  assert.ok(mine.items.some((m) => m.closureId === c1.id && m.ackStatus === TIME_CLOCK_ACK_STATUS.PENDING));
  assert.ok(mine.pendingCount >= 1);

  // Validation.
  const base = { companyId, candidateId, closureId: c1.id };
  const ack = (extra) => acknowledgeClosure({ query }, { ...base, ...extra });
  assert.equal((await ack({ action: 'x' })).errorCode, ERR.INVALID_DATA);
  assert.equal((await ack({ action: 'signed', signerName: 'ab', consent: true })).errorCode, ERR.DP_SIGNATURE_NAME_REQUIRED);
  assert.equal((await ack({ action: 'signed', signerName: 'Colab Demo', consent: false })).errorCode, ERR.TIME_CLOCK_ACK_CONSENT_REQUIRED);
  assert.equal((await ack({ action: 'disputed', note: 'curto' })).errorCode, ERR.TIME_CLOCK_DISPUTE_NOTE_REQUIRED);
  assert.equal(
    (await acknowledgeClosure({ query }, { ...base, closureId: 999999999, action: 'disputed', note: 'faltou um dia de trabalho' })).errorCode,
    ERR.NOT_FOUND
  );

  // Dispute → manager notified; dispute again locked; sign after dispute; sign again locked.
  const disp = await ack({ action: 'disputed', note: 'Faltou a hora extra de sexta.', signerIp: '10.0.0.1', signerUserAgent: 'dtov' });
  assert.equal(disp.ok, true, disp.errorCode);
  assert.equal(disp.item.ackStatus, TIME_CLOCK_ACK_STATUS.DISPUTED);
  assert.equal((await ack({ action: 'disputed', note: 'De novo a mesma coisa.' })).errorCode, ERR.TIME_CLOCK_ACK_LOCKED);
  const mgr = await notifyClosureDisputed(query, { companyId, candidateId, candidateName: 'Colab', item: disp.item });
  assert.ok(mgr.inserted >= 1, 'manager dispute notification');
  const mgrRow = await query(
    `SELECT COUNT(*)::int AS n FROM manager_notifications WHERE company_id = $1 AND type = $2 AND entity_id = $3`,
    [companyId, NOTIF.TIME_MIRROR_DISPUTED, c1.id]
  );
  assert.ok(mgrRow.rows[0].n >= 1);

  const signed = await ack({ action: 'signed', signerName: '  Colab   Demo ', consent: true, signerIp: '10.0.0.2', signerUserAgent: 'dtov-ua' });
  assert.equal(signed.ok, true, signed.errorCode);
  assert.equal(signed.item.ackStatus, TIME_CLOCK_ACK_STATUS.SIGNED);
  assert.equal(signed.item.signerName, 'Colab Demo');
  assert.equal(signed.item.snapshotHash, row.snapshotHash);
  assert.equal((await ack({ action: 'signed', signerName: 'Colab Demo', consent: true })).errorCode, ERR.TIME_CLOCK_ACK_LOCKED);
  const stored = await query(
    `SELECT signer_ip, signer_user_agent, consent_version, dispute_note FROM time_clock_closure_people
     WHERE closure_id = $1 AND candidate_id = $2`,
    [c1.id, candidateId]
  );
  assert.equal(stored.rows[0].signer_ip, '10.0.0.2');
  assert.equal(stored.rows[0].signer_user_agent, 'dtov-ua');
  assert.equal(stored.rows[0].consent_version, TIME_CLOCK_ACK_CONSENT_VERSION);
  assert.equal(stored.rows[0].dispute_note, 'Faltou a hora extra de sexta.');

  // Domain CHECKs hold even outside the lib.
  await assert.rejects(
    query(`UPDATE time_clock_closure_people SET ack_status = 'bogus' WHERE closure_id = $1 AND candidate_id = $2`, [c1.id, candidateId]),
    /time_clock_closure_people_ack_status_chk/
  );
  await assert.rejects(
    query(
      `UPDATE time_clock_closure_people SET signer_name = '' WHERE closure_id = $1 AND candidate_id = $2`,
      [c1.id, candidateId]
    ),
    /time_clock_closure_people_signed_chk/
  );

  const closures = await listTimeClockClosures({ query }, { companyId });
  const c1Row = closures.items.find((c) => c.id === c1.id);
  assert.ok(c1Row.acks.total >= 1 && c1Row.acks.signed >= 1, 'closure list ack counts');

  // Notifications: one per person per closure (dedupe).
  await query(
    `DELETE FROM candidate_notifications WHERE recipient_candidate_id = $1 AND type = $2`,
    [candidateId, EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE]
  );
  const n1 = await notifyClosureMirrorsReady(query, { companyId, closureId: c1.id, periodStart: day1, periodEnd: day1, candidateIds: [candidateId] });
  const n2 = await notifyClosureMirrorsReady(query, { companyId, closureId: c1.id, periodStart: day1, periodEnd: day1, candidateIds: [candidateId] });
  assert.equal(n1.inserted, 1);
  assert.equal(n2.inserted, 0);

  // Cancelled closure: rows kept, not listed to the collaborator, ack refused.
  const c2 = await createTimeClockClosure({ companyId, periodStart: day2, periodEnd: day2, userId });
  assert.equal(c2.ok, true, c2.errorCode);
  const cancel = await cancelTimeClockClosure({ companyId, closureId: c2.id, reason: 'dtov', userId });
  assert.equal(cancel.ok, true, cancel.errorCode);
  const kept = await listClosurePeople({ query }, { companyId, closureId: c2.id });
  assert.equal(kept.counts.total, c2.summaryCount);
  const afterCancel = await listEmployeeClosureAcks({ query }, { companyId, candidateId });
  assert.ok(!afterCancel.items.some((m) => m.closureId === c2.id));
  assert.equal(
    (await acknowledgeClosure({ query }, { ...base, closureId: c2.id, action: 'disputed', note: 'período cancelado mesmo' })).errorCode,
    ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE
  );
  assert.equal((await generateClosurePeople({ query }, { companyId, closureId: c2.id })).errorCode, ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE);

  // Older closure without rows: generate once (same numbers), second call is a no-op.
  const c3 = await createTimeClockClosure({ companyId, periodStart: day3, periodEnd: day3, userId });
  assert.equal(c3.ok, true, c3.errorCode);
  const before = await listClosurePeople({ query }, { companyId, closureId: c3.id, q: 'colaborador' });
  const beforeRow = before.items.find((p) => p.candidateId === candidateId);
  await query(`DELETE FROM time_clock_closure_people WHERE closure_id = $1`, [c3.id]);
  const gen = await generateClosurePeople({ query }, { companyId, closureId: c3.id });
  assert.equal(gen.ok, true, gen.errorCode);
  assert.equal(gen.count, c3.summaryCount);
  const again = await generateClosurePeople({ query }, { companyId, closureId: c3.id });
  assert.equal(again.count, 0);
  const after = await listClosurePeople({ query }, { companyId, closureId: c3.id, q: 'colaborador' });
  const afterRow = after.items.find((p) => p.candidateId === candidateId);
  assert.equal(afterRow.snapshotHash, beforeRow.snapshotHash);

  for (const id of [c1.id, c3.id]) {
    await cancelTimeClockClosure({ companyId, closureId: id, reason: 'dtov cleanup', userId });
  }
  await query(`UPDATE candidates SET start_date = $2 WHERE id = $1`, [candidateId, prevStart.rows[0].start_date]);
  console.log('time-clock-closure-people DTOV: ok');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
