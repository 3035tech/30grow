/**
 * DTOV: B-2722 hour bank computed from the timesheet (migration 143): opening balance from
 * the old ledger, extra − missing per day, manual entries, cap, holiday, closure freeze, CSV.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  HOLIDAY_RECURRENCE,
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_SOURCE,
  HOUR_BANK_STATUS,
  TIME_PUNCH_KIND,
  TIME_PUNCH_SOURCE,
} from '../../lib/domain-status.js';
import {
  createHourBankManualEntry,
  exportHourBankCsv,
  getHourBankBalance,
  listHourBankBalances,
} from '../../lib/people/hour-bank.js';
import { createTimePunch, isoDayInTz, upsertCompanyTimeSchedule } from '../../lib/people/time-clock.js';
import {
  addDaysIso,
  cancelTimeClockClosure,
  createTimeClockClosure,
  getEmployeeTimeMirror,
} from '../../lib/people/time-clock-manager.js';
import { deleteHoliday, saveEmployeeSchedule, saveHoliday } from '../../lib/people/time-clock-calendar.js';

const TZ = 'UTC';

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = co.rows[0].id;
  const emp = await query(
    `SELECT id FROM candidates WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo' LIMIT 1`,
    [companyId]
  );
  assert.ok(emp.rowCount, 'demo collaborator missing');
  const candidateId = emp.rows[0].id;
  const hr = await query(
    `SELECT id AS "userId" FROM users WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  const userId = hr.rows[0]?.userId || null;

  const today = isoDayInTz(new Date(), TZ);
  const W = addDaysIso(today, -3);
  const weekday = new Date(`${W}T12:00:00Z`).getUTCDay();

  const cleanup = async () => {
    await query(`DELETE FROM employee_hour_bank_entries WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_day_justifications WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_schedules WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM company_holidays WHERE company_id = $1`, [companyId]);
  };
  await cleanup();

  await query(`UPDATE company_time_schedules SET hour_bank_enabled = FALSE WHERE company_id = $1`, [companyId]);
  const disabled = await createHourBankManualEntry({ query }, {
    companyId, candidateId, entryKind: HOUR_BANK_ENTRY_KIND.CREDIT, minutes: 60, workOn: W, createdByUserId: userId,
  });
  assert.equal(disabled.errorCode, ERR.HOUR_BANK_DISABLED);

  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId, workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, timezone: TZ,
    lateGraceMinutes: 5, hourBankEnabled: true, hourBankMaxMinutes: 2400, updatedByUserId: userId,
  });
  assert.equal(sched.ok, true, sched.errorCode);
  assert.equal(sched.schedule.hourBankStartedOn, today, 'bank start resets to today when switched on');

  // Start the bank on W; the person only works on W's weekday (08h, no break) so other days rest.
  await query(`UPDATE company_time_schedules SET hour_bank_started_on = $2::date WHERE company_id = $1`, [companyId, W]);
  const own = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: addDaysIso(W, -20), userId,
    workdayStart: '09:00', workdayEnd: '17:00', weekdays: [weekday],
  });
  assert.equal(own.ok, true, own.errorCode);

  // Old ledger: approved credit before the start = opening balance; clock credit after = ignored.
  await query(
    `INSERT INTO employee_hour_bank_entries
       (company_id, candidate_id, entry_kind, minutes, work_on, status, source, note, created_by_candidate_id)
     VALUES ($1, $2, '${HOUR_BANK_ENTRY_KIND.CREDIT}', 30, $3::date, '${HOUR_BANK_STATUS.APPROVED}', '${HOUR_BANK_SOURCE.MANUAL}', 'legado', $2),
            ($1, $2, '${HOUR_BANK_ENTRY_KIND.CREDIT}', 999, $4::date, '${HOUR_BANK_STATUS.APPROVED}', '${HOUR_BANK_SOURCE.TIME_CLOCK}', 'legado ponto', $2)`,
    [companyId, candidateId, addDaysIso(W, -5), W]
  );

  for (const [hm, kind] of [['09:00', TIME_PUNCH_KIND.IN], ['19:00', TIME_PUNCH_KIND.OUT]]) {
    const r = await createTimePunch({ query }, {
      companyId, candidateId, punchKind: kind, source: TIME_PUNCH_SOURCE.WEB, punchedAt: `${W}T${hm}:00.000Z`,
    });
    assert.equal(r.ok, true, r.errorCode);
  }

  const manual = await createHourBankManualEntry({ query }, {
    companyId, candidateId, entryKind: HOUR_BANK_ENTRY_KIND.CREDIT, minutes: 60, workOn: addDaysIso(W, 1), note: 'manual', createdByUserId: userId,
  });
  assert.equal(manual.ok, true, manual.errorCode);

  const bal = await getHourBankBalance({ query }, { companyId, candidateId });
  assert.equal(bal.balanceMinutes, 30 + 120 + 60, 'opening + extra on W + manual');

  const list = await listHourBankBalances({ query }, { companyId, q: 'colaborador' });
  assert.equal(list.ok, true);
  const row = list.items.find((i) => Number(i.candidateId) === Number(candidateId));
  assert.equal(row?.balanceMinutes, 210);
  assert.equal(row?.overCapMinutes, 0);

  // Holiday on W: nothing expected, the whole 10h counts as extra.
  const hol = await saveHoliday({ query }, { companyId, userId, name: 'Feriado teste', day: W, recurrence: HOLIDAY_RECURRENCE.ONCE });
  assert.equal(hol.ok, true, hol.errorCode);
  assert.equal((await getHourBankBalance({ query }, { companyId, candidateId })).balanceMinutes, 30 + 600 + 60);
  assert.equal((await deleteHoliday({ query }, { companyId, id: hol.id })).ok, true);

  // Cap: credits stop at the cap, excess reported.
  await query(`UPDATE company_time_schedules SET hour_bank_max_minutes = 200 WHERE company_id = $1`, [companyId]);
  const capped = await getHourBankBalance({ query }, { companyId, candidateId });
  assert.equal(capped.balanceMinutes, 200);
  assert.equal(capped.overCapMinutes, 10);
  await query(`UPDATE company_time_schedules SET hour_bank_max_minutes = 2400 WHERE company_id = $1`, [companyId]);

  // Closure freezes the balance up to its end.
  const closure = await createTimeClockClosure({ companyId, periodStart: addDaysIso(W, -2), periodEnd: W, userId });
  assert.equal(closure.ok, true, closure.errorCode);
  const frozen = await query(
    `SELECT balance_minutes AS b, extra_minutes AS e FROM time_clock_closure_balances WHERE closure_id = $1 AND candidate_id = $2`,
    [closure.id, candidateId]
  );
  assert.equal(Number(frozen.rows[0]?.b), 150, 'snapshot = opening + extra on W');
  assert.equal(Number(frozen.rows[0]?.e), 120);

  const lockedManual = await createHourBankManualEntry({ query }, {
    companyId, candidateId, entryKind: HOUR_BANK_ENTRY_KIND.CREDIT, minutes: 10, workOn: W, createdByUserId: userId,
  });
  assert.equal(lockedManual.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);

  // A late raw punch inside the closed period no longer moves the balance.
  await query(
    `INSERT INTO employee_time_punches (company_id, candidate_id, punched_at, punch_kind, source)
     VALUES ($1, $2, $3::timestamptz, '${TIME_PUNCH_KIND.IN}', '${TIME_PUNCH_SOURCE.WEB}'),
            ($1, $2, $4::timestamptz, '${TIME_PUNCH_KIND.OUT}', '${TIME_PUNCH_SOURCE.WEB}')`,
    [companyId, candidateId, `${W}T20:00:00Z`, `${W}T22:00:00Z`]
  );
  assert.equal((await getHourBankBalance({ query }, { companyId, candidateId })).balanceMinutes, 210, 'frozen');

  const mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: addDaysIso(W, -1), to: today });
  assert.equal(mirror.ok, true, mirror.errorCode);
  assert.equal(mirror.hourBankStartedOn, W);
  assert.equal(mirror.days.find((d) => d.day === W).bankBalanceMinutes, 150, 'mirror anchors on the snapshot');
  assert.equal(mirror.days[mirror.days.length - 1].bankBalanceMinutes, 210);

  const unlocked = await cancelTimeClockClosure({ companyId, closureId: closure.id, reason: 'fim do teste', userId });
  assert.equal(unlocked.ok, true, unlocked.errorCode);
  assert.equal((await getHourBankBalance({ query }, { companyId, candidateId })).balanceMinutes, 330, 'cancelled closure releases the freeze');

  const csv = await exportHourBankCsv({ query }, { companyId, month: W.slice(0, 7) });
  assert.equal(csv.ok, true, csv.errorCode);
  assert.ok(csv.csv.includes('candidate_id'));

  await cleanup();
  console.log('hour-bank.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
