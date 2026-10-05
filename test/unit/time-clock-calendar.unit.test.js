/**
 * Ponto fase 2 pure helpers (offline): effective schedule, holidays, computed hour-bank step.
 * Run: node --test test/unit/time-clock-calendar.unit.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOLIDAY_RECURRENCE,
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_SCHEDULE_SOURCE,
} from '../../lib/domain-status.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  buildHolidayIndex,
  buildPersonCalendar,
  easterSunday,
  expandHolidays,
  holidayHitsClosure,
  nationalHolidays,
  normalizeEmployeeSchedule,
  normalizeWeekdays,
} from '../../lib/people/time-clock-calendar.js';
import {
  isWorkdayIso,
  resolveDaySchedule,
  stepHourBank,
  summarizeTimeDay,
} from '../../lib/people/time-day-summary.js';
import { hourBankDayNet } from '../../lib/people/hour-bank-balance.js';

const COMPANY = { workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60, lateGraceMinutes: 10 };

function punch(id, iso, hm, kind) {
  return { id, punchedAt: `${iso}T${hm}:00-03:00`, punchKind: kind };
}

describe('stepHourBank', () => {
  it('adds freely below the cap', () => {
    assert.deepEqual(stepHourBank(100, { net: 30, manual: 20, cap: 600 }), { balance: 150, overCap: 0 });
  });
  it('clamps credits at the cap and reports the excess', () => {
    assert.deepEqual(stepHourBank(580, { net: 60, cap: 600 }), { balance: 600, overCap: 40 });
  });
  it('never lowers a balance already above the cap because of a credit', () => {
    assert.deepEqual(stepHourBank(700, { net: 30, cap: 600 }), { balance: 700, overCap: 30 });
  });
  it('debits always apply, even above the cap', () => {
    assert.deepEqual(stepHourBank(700, { net: -50, cap: 600 }), { balance: 650, overCap: 0 });
  });
  it('without cap is a plain sum', () => {
    assert.deepEqual(stepHourBank(-30, { net: -20, manual: 5, cap: null }), { balance: -45, overCap: 0 });
  });
});

describe('hourBankDayNet', () => {
  it('extra minus missing only when the person records time', () => {
    assert.equal(hourBankDayNet({ extraMinutes: 30, missingMinutes: 0 }, true), 30);
    assert.equal(hourBankDayNet({ extraMinutes: 0, missingMinutes: 45 }, true), -45);
    assert.equal(hourBankDayNet({ extraMinutes: 30, missingMinutes: 0 }, false), 0);
  });
});

describe('resolveDaySchedule', () => {
  const rows = [
    { validFrom: '2026-03-01', followsCompany: false, workdayStart: '07:00', workdayEnd: '13:00', breakStart: null, breakEnd: null, weekdays: [1, 2, 3, 4, 5, 6] },
    { validFrom: '2026-05-01', followsCompany: true },
    { validFrom: '2026-07-01', followsCompany: false, workdayStart: '10:00', workdayEnd: '19:00', breakStart: '13:00', breakEnd: '14:30', weekdays: [2, 3, 4] },
  ];
  it('uses the company schedule before any version', () => {
    const s = resolveDaySchedule(COMPANY, rows, '2026-02-15');
    assert.equal(s.source, TIME_SCHEDULE_SOURCE.COMPANY);
    assert.equal(s.workdayStart, '09:00');
    assert.deepEqual(s.weekdays, [1, 2, 3, 4, 5]);
  });
  it('applies the latest version on or before the day', () => {
    const s = resolveDaySchedule(COMPANY, rows, '2026-03-01');
    assert.equal(s.source, TIME_SCHEDULE_SOURCE.EMPLOYEE);
    assert.equal(s.workdayStart, '07:00');
    assert.equal(s.breakMinutes, 0);
    assert.equal(s.lateGraceMinutes, 10);
  });
  it('a follows-company version returns to the company schedule', () => {
    assert.equal(resolveDaySchedule(COMPANY, rows, '2026-06-10').source, TIME_SCHEDULE_SOURCE.COMPANY);
  });
  it('break start/end define the break minutes', () => {
    const s = resolveDaySchedule(COMPANY, rows, '2026-08-01');
    assert.equal(s.breakMinutes, 90);
    assert.deepEqual(s.weekdays, [2, 3, 4]);
  });
});

describe('normalizeEmployeeSchedule / normalizeWeekdays', () => {
  it('sorts and dedupes weekdays; rejects out of range', () => {
    assert.deepEqual(normalizeWeekdays([5, '1', 1, 3]), [1, 3, 5]);
    assert.equal(normalizeWeekdays([7]), null);
    assert.equal(normalizeWeekdays([]), null);
  });
  it('follows company clears every field', () => {
    const r = normalizeEmployeeSchedule({ followsCompany: true, workdayStart: '08:00' });
    assert.equal(r.ok, true);
    assert.equal(r.value.workdayStart, null);
    assert.equal(r.value.weekdays, null);
  });
  it('validates times, order and break inside the workday', () => {
    const ok = normalizeEmployeeSchedule({ workdayStart: '8:00', workdayEnd: '17:00', breakStart: '12:00', breakEnd: '13:00', weekdays: [1, 2] });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.workdayStart, '08:00');
    for (const bad of [
      { workdayStart: '18:00', workdayEnd: '08:00', weekdays: [1] },
      { workdayStart: '08:00', workdayEnd: '17:00', weekdays: [] },
      { workdayStart: '08:00', workdayEnd: '17:00', breakStart: '07:00', breakEnd: '09:00', weekdays: [1] },
      { workdayStart: '08:00', workdayEnd: '17:00', breakStart: '12:00', weekdays: [1] },
      { workdayStart: '25:00', workdayEnd: '26:00', weekdays: [1] },
    ]) {
      assert.deepEqual(normalizeEmployeeSchedule(bad), { ok: false, errorCode: ERR.INVALID_DATA });
    }
  });
});

describe('holidays', () => {
  it('Easter and Good Friday 2026', () => {
    assert.equal(easterSunday(2026), '2026-04-05');
    const days = nationalHolidays(2026).map((h) => h.day);
    assert.ok(days.includes('2026-04-03'));
    assert.ok(days.includes('2026-11-20'));
    assert.equal(new Set(days).size, days.length);
  });
  it('Consciência Negra only from 2024', () => {
    assert.ok(!nationalHolidays(2023).some((h) => h.day === '2023-11-20'));
    assert.equal(nationalHolidays(2023).length, nationalHolidays(2026).length - 1);
  });
  it('expands one-off and yearly occurrences inside the range', () => {
    const rows = [
      { id: 1, day: '2026-01-25', recurrence: HOLIDAY_RECURRENCE.ONCE },
      { id: 2, day: '2025-07-09', recurrence: HOLIDAY_RECURRENCE.YEARLY },
      { id: 3, day: '2027-07-09', recurrence: HOLIDAY_RECURRENCE.YEARLY },
    ];
    const out = expandHolidays(rows, '2026-01-01', '2026-12-31').map((h) => `${h.id}:${h.occursOn}`);
    assert.deepEqual(out, ['1:2026-01-25', '2:2026-07-09']);
  });
  it('yearly Feb 29 only happens in leap years', () => {
    const rows = [{ id: 1, day: '2024-02-29', recurrence: HOLIDAY_RECURRENCE.YEARLY }];
    assert.equal(expandHolidays(rows, '2025-01-01', '2027-12-31').length, 0);
    assert.equal(expandHolidays(rows, '2028-01-01', '2028-12-31')[0].occursOn, '2028-02-29');
  });
  it('unit holidays apply to the unit chain only', () => {
    const occ = [
      { id: 1, name: 'Empresa', occursOn: '2026-03-10', orgUnitId: null },
      { id: 2, name: 'SP', occursOn: '2026-03-11', orgUnitId: 5 },
      { id: 3, name: 'RJ', occursOn: '2026-03-12', orgUnitId: 9 },
    ];
    const index = buildHolidayIndex(occ, [7, 5]);
    assert.deepEqual([...index.keys()], ['2026-03-10', '2026-03-11']);
  });
  it('holidayHitsClosure respects scope and yearly occurrences', () => {
    const ancestorsOf = (id) => ({ 5: [5], 7: [7, 5], 9: [9] }[Number(id)] || (id == null ? [] : [Number(id)]));
    const scopes = { ancestorsOf, closures: [{ start: '2026-03-01', end: '2026-03-31', orgUnitId: 7 }] };
    assert.equal(holidayHitsClosure(scopes, { orgUnitId: null, day: '2026-03-10', recurrence: HOLIDAY_RECURRENCE.ONCE }), true);
    assert.equal(holidayHitsClosure(scopes, { orgUnitId: 5, day: '2026-03-10', recurrence: HOLIDAY_RECURRENCE.ONCE }), true);
    assert.equal(holidayHitsClosure(scopes, { orgUnitId: 9, day: '2026-03-10', recurrence: HOLIDAY_RECURRENCE.ONCE }), false);
    assert.equal(holidayHitsClosure(scopes, { orgUnitId: null, day: '2020-03-15', recurrence: HOLIDAY_RECURRENCE.YEARLY }), true);
    assert.equal(holidayHitsClosure(scopes, { orgUnitId: null, day: '2026-04-15', recurrence: HOLIDAY_RECURRENCE.ONCE }), false);
  });
});

describe('summarizeTimeDay with holidays and weekdays', () => {
  const schedule = resolveDaySchedule(COMPANY, [], '2026-04-03');
  it('holiday without punches is HOLIDAY with no missing hours', () => {
    const s = summarizeTimeDay({ punches: [], schedule, isWorkday: true, holiday: { name: 'Sexta-feira Santa' } });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.HOLIDAY);
    assert.equal(s.expectedMinutes, 0);
    assert.equal(s.missingMinutes, 0);
  });
  it('time worked on a holiday counts as extra', () => {
    const punches = [punch(1, '2026-04-03', '09:00', TIME_PUNCH_KIND.IN), punch(2, '2026-04-03', '13:00', TIME_PUNCH_KIND.OUT)];
    const s = summarizeTimeDay({ punches, schedule, isWorkday: true, holiday: { name: 'x' } });
    assert.equal(s.extraMinutes, 240);
  });
  it('employee weekdays decide the workday', () => {
    assert.equal(isWorkdayIso('2026-04-04', [6]), true);
    assert.equal(isWorkdayIso('2026-04-06', [6]), false);
  });
  it('buildPersonCalendar merges schedule versions and holidays', () => {
    const cal = buildPersonCalendar({
      companySchedule: COMPANY,
      scheduleRows: [{ validFrom: '2026-04-01', followsCompany: false, workdayStart: '08:00', workdayEnd: '12:00', breakStart: null, breakEnd: null, weekdays: [6] }],
      holidayOccurrences: [{ id: 1, name: 'Tiradentes', occursOn: '2026-04-21', orgUnitId: null }],
      unitChain: [],
    });
    assert.equal(cal('2026-03-31').isWorkday, true);
    assert.equal(cal('2026-04-01').isWorkday, false);
    assert.equal(cal('2026-04-04').isWorkday, true);
    assert.equal(cal('2026-04-04').schedule.workdayStart, '08:00');
    assert.equal(cal('2026-04-21').holiday.name, 'Tiradentes');
  });
});
