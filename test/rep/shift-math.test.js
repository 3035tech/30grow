import test from 'node:test';
import assert from 'node:assert/strict';
import { employmentOn } from '../../lib/people/time-clock-history.js';
import {
  summarizeTimeDay,
  resolveDaySchedule,
  shiftStillOpen,
} from '../../lib/people/time-day-summary.js';
import {
  normalizeEmployeeSchedule,
  buildPersonCalendar,
} from '../../lib/people/time-clock-calendar.js';
import { suggestPunchFlag } from '../../lib/people/time-clock.js';
const schedule = {
  timezone: 'UTC',
  workdayStart: '22:00',
  workdayEnd: '06:00',
  breakStart: '02:00',
  breakEnd: '03:00',
  breakMinutes: 60,
  lateGraceMinutes: 10,
  nightRule: 'urban_clt',
};
const punches = [
  ['2026-09-01T22:00:00Z', 'in'],
  ['2026-09-02T02:00:00Z', 'out'],
  ['2026-09-02T03:00:00Z', 'in'],
  ['2026-09-02T06:00:00Z', 'out'],
].map(([punchedAt, punchKind]) => ({ punchedAt, punchKind }));
test('exit date is included; employment gap and rehire boundaries remain separate', () => {
  const employee = {
    startDate: '2026-01-01',
    exits: [{ exitDate: '2026-02-10', rehiredAt: '2026-03-01' }],
  };
  assert.equal(employmentOn('2025-12-31', employee), false);
  assert.equal(employmentOn('2026-02-10', employee), true);
  assert.equal(employmentOn('2026-02-11', employee), false);
  assert.equal(employmentOn('2026-03-01', employee), true);
});
test('night hours preserve physical time and expose urban equivalent without extra bank credit', () => {
  const s = summarizeTimeDay({ schedule, punches });
  assert.equal(s.workedMinutes, 420);
  assert.equal(s.expectedMinutes, 420);
  assert.equal(s.nightMinutes, 360);
  assert.equal(s.nightEquivalentMinutes, 411);
  assert.equal(s.extraMinutes, 0);
  assert.equal(s.missingMinutes, 0);
});
test('partial overnight excuse credits only the unworked scheduled interval', () => {
  const s = summarizeTimeDay({
    schedule,
    punches: punches.slice(0, 2),
    justification: { excusedStart: '03:00', excusedEnd: '06:00' },
  });
  assert.equal(s.missingMinutes, 0);
  assert.equal(s.requiresScheduleReview, false);
});
test('12x36 validates twelve-hour span and alternates over month boundaries', () => {
  const row = {
    validFrom: '2026-08-31',
    workdayStart: '18:00',
    workdayEnd: '06:00',
    breakStart: '00:00',
    breakEnd: '01:00',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    shiftPattern: '12x36',
    cycleAnchor: '2026-08-31',
  };
  assert.equal(normalizeEmployeeSchedule(row).ok, true);
  assert.equal(
    normalizeEmployeeSchedule({ ...row, workdayEnd: '05:00' }).ok,
    false,
  );
  const info = buildPersonCalendar({
    companySchedule: schedule,
    scheduleRows: [row],
  });
  assert.equal(info('2026-08-31').isWorkday, true);
  assert.equal(info('2026-09-01').isWorkday, false);
  assert.equal(info('2026-09-02').isWorkday, true);
  const s = resolveDaySchedule(schedule, [row], '2026-09-02');
  assert.equal(s.breakMinutes, 60);
  assert.equal(
    summarizeTimeDay({ schedule: s, holiday: { name: 'Holiday' } })
      .expectedMinutes,
    660,
  );
});
test('overnight closure waits for the contractual ending time', () => {
  assert.equal(
    shiftStillOpen('2026-09-01', schedule, new Date('2026-09-02T05:59:00Z')),
    true,
  );
  assert.equal(
    shiftStillOpen('2026-09-01', schedule, new Date('2026-09-02T06:00:00Z')),
    false,
  );
});
test('night return from break and final out compare on the same shift timeline', () => {
  assert.equal(
    suggestPunchFlag({
      schedule,
      punchKind: 'out',
      punchedAt: new Date('2026-09-02T06:00:00Z'),
      todayPunches: punches.slice(0, 3),
    }),
    null,
  );
  assert.equal(
    suggestPunchFlag({
      schedule,
      punchKind: 'in',
      punchedAt: new Date('2026-09-01T22:12:00Z'),
      todayPunches: [],
    }),
    'late',
  );
});
