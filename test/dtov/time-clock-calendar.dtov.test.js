/**
 * DTOV: Ponto fase 2: holidays (CRUD, yearly, unit scope, national import, closed period)
 * and per-employee schedules (effective-dated, follows company, closed period) in the mirror.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  HOLIDAY_RECURRENCE,
  HOLIDAY_SOURCE,
  TIME_DAY_OCCURRENCE,
  TIME_SCHEDULE_SOURCE,
} from '../../lib/domain-status.js';
import { isoDayInTz, upsertCompanyTimeSchedule } from '../../lib/people/time-clock.js';
import {
  addDaysIso,
  cancelTimeClockClosure,
  createTimeClockClosure,
  getEmployeeTimeMirror,
} from '../../lib/people/time-clock-manager.js';
import {
  deleteEmployeeSchedule,
  deleteHoliday,
  importNationalHolidays,
  listEmployeeScheduleHistory,
  listHolidays,
  nationalHolidays,
  saveEmployeeSchedule,
  saveHoliday,
} from '../../lib/people/time-clock-calendar.js';

const TZ = 'UTC';

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = co.rows[0].id;
  const emp = await query(
    `SELECT id, org_unit_id AS "orgUnitId" FROM candidates WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo' LIMIT 1`,
    [companyId]
  );
  const candidateId = emp.rows[0].id;
  const hr = await query(
    `SELECT id AS "userId" FROM users WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  const userId = hr.rows[0]?.userId || null;

  const cleanup = async () => {
    await query(`DELETE FROM employee_time_punches WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM employee_time_schedules WHERE company_id = $1 AND candidate_id = $2`, [companyId, candidateId]);
    await query(`DELETE FROM company_holidays WHERE company_id = $1`, [companyId]);
  };
  await cleanup();

  const sched = await upsertCompanyTimeSchedule({ query }, {
    companyId, workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, timezone: TZ,
    lateGraceMinutes: 5, hourBankEnabled: false, hourBankMaxMinutes: 2400, updatedByUserId: userId,
  });
  assert.equal(sched.ok, true, sched.errorCode);

  const today = isoDayInTz(new Date(), TZ);
  const D = addDaysIso(today, -4);
  const year = Number(D.slice(0, 4));

  // ── Holidays ──
  const bad = await saveHoliday({ query }, { companyId, name: '', day: D, recurrence: HOLIDAY_RECURRENCE.ONCE });
  assert.equal(bad.errorCode, ERR.INVALID_DATA);
  const yearly = await saveHoliday({ query }, {
    companyId, userId, name: 'Aniversário da empresa', day: `${year - 3}${D.slice(4)}`, recurrence: HOLIDAY_RECURRENCE.YEARLY,
  });
  assert.equal(yearly.ok, true, yearly.errorCode);
  const dup = await saveHoliday({ query }, { companyId, name: 'Outro', day: `${year - 3}${D.slice(4)}`, recurrence: HOLIDAY_RECURRENCE.ONCE });
  assert.equal(dup.errorCode, ERR.HOLIDAY_DUPLICATE);

  const listed = await listHolidays({ query }, { companyId, year, q: 'aniversário' });
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].occursOn, D, 'yearly holiday shows on this year');

  let mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: D, to: D });
  assert.equal(mirror.ok, true, mirror.errorCode);
  assert.equal(mirror.days[0].holiday?.name, 'Aniversário da empresa');
  assert.equal(mirror.days[0].occurrence, TIME_DAY_OCCURRENCE.HOLIDAY);
  assert.equal(mirror.days[0].expectedMinutes, 0);
  assert.equal(mirror.days[0].missingMinutes, 0);
  assert.equal(mirror.totals.holidays, 1);

  // Unit holiday of another unit does not apply to the person.
  const otherUnit = await query(
    `SELECT id FROM org_units WHERE company_id = $1 AND id IS DISTINCT FROM $2 LIMIT 1`,
    [companyId, emp.rows[0].orgUnitId]
  );
  if (otherUnit.rowCount && emp.rows[0].orgUnitId == null) {
    const unitHol = await saveHoliday({ query }, {
      companyId, userId, name: 'Feriado local', day: addDaysIso(D, 1), recurrence: HOLIDAY_RECURRENCE.ONCE, orgUnitId: otherUnit.rows[0].id,
    });
    assert.equal(unitHol.ok, true, unitHol.errorCode);
    mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: addDaysIso(D, 1), to: addDaysIso(D, 1) });
    assert.equal(mirror.days[0].holiday, null, 'other unit holiday ignored');
  }

  const imported = await importNationalHolidays({ query }, { companyId, year: 2031, userId });
  assert.equal(imported.ok, true, imported.errorCode);
  assert.equal(imported.inserted, nationalHolidays(2031).length);
  const again = await importNationalHolidays({ query }, { companyId, year: 2031, userId });
  assert.equal(again.inserted, 0);
  assert.equal(again.existing, nationalHolidays(2031).length);
  const list2031 = await listHolidays({ query }, { companyId, year: 2031, pageSize: 50 });
  assert.ok(list2031.items.filter((h) => h.source === HOLIDAY_SOURCE.NATIONAL).length === nationalHolidays(2031).length);

  // ── Employee schedule ──
  const invalid = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: D, workdayStart: '18:00', workdayEnd: '08:00', weekdays: [1],
  });
  assert.equal(invalid.errorCode, ERR.INVALID_DATA);
  const allWeek = [0, 1, 2, 3, 4, 5, 6];
  const v1 = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: addDaysIso(D, -1), userId,
    workdayStart: '08:00', workdayEnd: '12:00', weekdays: allWeek,
  });
  assert.equal(v1.ok, true, v1.errorCode);
  const back = await saveEmployeeSchedule({ query }, { companyId, candidateId, validFrom: addDaysIso(D, 1), userId, followsCompany: true });
  assert.equal(back.ok, true, back.errorCode);

  const hist = await listEmployeeScheduleHistory({ query }, { companyId, candidateId });
  assert.equal(hist.items.length, 2);
  assert.equal(hist.items[0].followsCompany, true);

  mirror = await getEmployeeTimeMirror({ query }, { companyId, candidateId, from: addDaysIso(D, -1), to: addDaysIso(D, 1) });
  const [before, onHoliday, after] = mirror.days;
  assert.equal(before.daySchedule.source, TIME_SCHEDULE_SOURCE.EMPLOYEE);
  assert.equal(before.isWorkday, true);
  assert.equal(before.expectedMinutes, 240);
  assert.equal(onHoliday.expectedMinutes, 0);
  assert.equal(after.daySchedule.source, TIME_SCHEDULE_SOURCE.COMPANY);

  // ── Closed period blocks schedule and holiday edits ──
  const closure = await createTimeClockClosure({ companyId, periodStart: addDaysIso(D, -1), periodEnd: addDaysIso(D, 1), userId });
  assert.equal(closure.ok, true, closure.errorCode);
  const lockedSchedule = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: D, userId, workdayStart: '08:00', workdayEnd: '17:00', weekdays: [1],
  });
  assert.equal(lockedSchedule.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  assert.equal((await deleteEmployeeSchedule({ query }, { companyId, candidateId, id: v1.item.id })).errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  assert.equal((await deleteHoliday({ query }, { companyId, id: yearly.id })).errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED);
  const lockedNew = await saveHoliday({ query }, { companyId, name: 'Novo', day: D.replace(/^\d{4}/, String(year - 1)), recurrence: HOLIDAY_RECURRENCE.YEARLY });
  assert.equal(lockedNew.errorCode, ERR.TIME_CLOCK_PERIOD_CLOSED, 'yearly holiday falling in the closure');
  const futureSchedule = await saveEmployeeSchedule({ query }, {
    companyId, candidateId, validFrom: addDaysIso(today, 7), userId, workdayStart: '08:00', workdayEnd: '17:00', weekdays: [1, 2],
  });
  assert.equal(futureSchedule.ok, true, futureSchedule.errorCode);

  const cancelled = await cancelTimeClockClosure({ companyId, closureId: closure.id, reason: 'fim do teste', userId });
  assert.equal(cancelled.ok, true, cancelled.errorCode);
  assert.equal((await deleteHoliday({ query }, { companyId, id: yearly.id })).ok, true);
  assert.equal((await deleteEmployeeSchedule({ query }, { companyId, candidateId, id: v1.item.id })).ok, true);

  await cleanup();
  console.log('time-clock-calendar.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
