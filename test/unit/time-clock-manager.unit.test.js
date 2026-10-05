/**
 * Manager time clock pure helpers (offline): day summary, calendar math, formatters.
 * Run: node --test test/unit/time-clock-manager.unit.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
} from '../../lib/domain-status.js';
import { ERR } from '../../lib/api-error-codes.js';
import {
  addDaysIso,
  daySpan,
  excusedIntervalMinutes,
  isWorkdayIso,
  normalizeTimeAdjustment,
  normalizeTimeExcuse,
  summarizeTimeDay,
  TIME_ADJUST_MAX_ADD,
} from '../../lib/people/time-clock-manager.js';
import { isDayInLocks } from '../../lib/people/time-clock.js';
import {
  formatMinutesClock,
  formatMinutesHm,
  hmInZone,
  hmSpanMinutes,
  shiftIsoDay,
  timeClockPeriodFor,
} from '../../lib/time-clock-format.js';

const schedule = {
  workdayStart: '09:00',
  workdayEnd: '18:00',
  breakMinutes: 60,
  lateGraceMinutes: 10,
  timezone: 'UTC',
};

const punch = (id, iso, kind, extra = {}) => ({
  id,
  punchedAt: iso,
  punchKind: kind,
  reviewStatus: TIME_PUNCH_REVIEW.NONE,
  voidedAt: null,
  ...extra,
});

const fullDay = [
  punch(1, '2026-09-28T09:00:00Z', TIME_PUNCH_KIND.IN),
  punch(2, '2026-09-28T12:00:00Z', TIME_PUNCH_KIND.OUT),
  punch(3, '2026-09-28T13:00:00Z', TIME_PUNCH_KIND.IN),
  punch(4, '2026-09-28T18:00:00Z', TIME_PUNCH_KIND.OUT),
];

describe('summarizeTimeDay', () => {
  it('regular day within tolerance', () => {
    const s = summarizeTimeDay({ punches: fullDay, schedule });
    assert.equal(s.workedMinutes, 480);
    assert.equal(s.extraMinutes, 0);
    assert.equal(s.missingMinutes, 0);
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.OK);
  });

  it('extra beyond tolerance counts in full', () => {
    const punches = [...fullDay.slice(0, 3), punch(4, '2026-09-28T18:30:00Z', TIME_PUNCH_KIND.OUT)];
    const s = summarizeTimeDay({ punches, schedule });
    assert.equal(s.extraMinutes, 30);
  });

  it('small differences stay inside the daily tolerance', () => {
    const punches = [...fullDay.slice(0, 3), punch(4, '2026-09-28T17:55:00Z', TIME_PUNCH_KIND.OUT)];
    const s = summarizeTimeDay({ punches, schedule });
    assert.equal(s.missingMinutes, 0);
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.OK);
  });

  it('workday without punches is an absence with full missing hours', () => {
    const s = summarizeTimeDay({ punches: [], schedule });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.ABSENCE);
    assert.equal(s.missingMinutes, 480);
  });

  it('justification waives missing hours', () => {
    const s = summarizeTimeDay({ punches: [], schedule, justification: { reason: 'holiday' } });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.JUSTIFIED);
    assert.equal(s.missingMinutes, 0);
  });

  it('weekend and before-start days are rest, not absence', () => {
    assert.equal(summarizeTimeDay({ punches: [], schedule, isWorkday: false }).occurrence, TIME_DAY_OCCURRENCE.REST);
    assert.equal(summarizeTimeDay({ punches: [], schedule, beforeStart: true }).occurrence, TIME_DAY_OCCURRENCE.REST);
    assert.equal(summarizeTimeDay({ punches: [], schedule, isWorkday: false }).missingMinutes, 0);
  });

  it('unpaired punch on a past day is incomplete', () => {
    const s = summarizeTimeDay({ punches: fullDay.slice(0, 3), schedule });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.INCOMPLETE);
  });

  it('open punch today is in progress and never missing', () => {
    const s = summarizeTimeDay({ punches: fullDay.slice(0, 1), schedule, isToday: true });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.IN_PROGRESS);
    assert.equal(s.missingMinutes, 0);
  });

  it('voided punches are ignored but counted', () => {
    const punches = [...fullDay, punch(5, '2026-09-28T20:00:00Z', TIME_PUNCH_KIND.IN, { voidedAt: '2026-09-29T10:00:00Z' })];
    const s = summarizeTimeDay({ punches, schedule });
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.OK);
    assert.equal(s.voidedCount, 1);
    assert.equal(s.activeCount, 4);
  });

  it('flagged active punch asks for review', () => {
    const punches = fullDay.map((p, i) => (i === 0 ? { ...p, reviewStatus: TIME_PUNCH_REVIEW.FLAGGED } : p));
    assert.equal(summarizeTimeDay({ punches, schedule }).occurrence, TIME_DAY_OCCURRENCE.REVIEW);
  });
});

describe('partial excuse (interval)', () => {
  it('measures only valid intervals', () => {
    assert.equal(excusedIntervalMinutes({ excusedStart: '13:00', excusedEnd: '15:30' }), 150);
    assert.equal(excusedIntervalMinutes({ excusedStart: '15:00', excusedEnd: '13:00' }), null);
    assert.equal(excusedIntervalMinutes({ reason: 'other' }), null);
  });

  it('discounts the interval from missing hours', () => {
    const punches = fullDay.slice(0, 2);
    const s = summarizeTimeDay({
      punches,
      schedule,
      justification: { reason: 'medical_certificate', excusedStart: '13:00', excusedEnd: '15:00' },
    });
    assert.equal(s.workedMinutes, 180);
    assert.equal(s.missingMinutes, 180);
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.MISSING);
  });

  it('interval covering the gap leaves the day justified', () => {
    const punches = fullDay.slice(0, 2);
    const s = summarizeTimeDay({
      punches,
      schedule,
      justification: { reason: 'excused_absence', excusedStart: '13:00', excusedEnd: '18:00' },
    });
    assert.equal(s.missingMinutes, 0);
    assert.equal(s.occurrence, TIME_DAY_OCCURRENCE.JUSTIFIED);
  });
});

describe('request validation', () => {
  it('normalizes an adjustment', () => {
    const r = normalizeTimeAdjustment({
      voidPunchIds: [3, '3', 0, 'x'],
      add: [{ time: '8:05', kind: 'IN' }],
      reason: '  esqueci  ',
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.voids, [3]);
    assert.deepEqual(r.adds, [{ time: '08:05', kind: TIME_PUNCH_KIND.IN }]);
  });

  it('rejects empty, short reason, bad kind and too many adds', () => {
    assert.equal(normalizeTimeAdjustment({ reason: 'motivo' }).errorCode, ERR.INVALID_DATA);
    assert.equal(normalizeTimeAdjustment({ voidPunchIds: [1], reason: 'ab' }).errorCode, ERR.INVALID_DATA);
    assert.equal(normalizeTimeAdjustment({ add: [{ time: '09:00', kind: 'lunch' }], reason: 'motivo' }).ok, false);
    const many = Array.from({ length: TIME_ADJUST_MAX_ADD + 1 }, () => ({ time: '09:00', kind: 'in' }));
    assert.equal(normalizeTimeAdjustment({ add: many, reason: 'motivo' }).ok, false);
  });

  it('normalizes an excuse (whole day or interval)', () => {
    assert.deepEqual(normalizeTimeExcuse({ excuseReason: 'day_off' }), { ok: true, reason: 'day_off', start: null, end: null });
    const r = normalizeTimeExcuse({ excuseReason: 'other', excuseStart: '9:00', excuseEnd: '10:30' });
    assert.equal(r.ok, true);
    assert.equal(r.start, '09:00');
    assert.equal(normalizeTimeExcuse({ excuseReason: 'other', excuseStart: '10:00', excuseEnd: '09:00' }).ok, false);
    assert.equal(normalizeTimeExcuse({ excuseReason: 'other', excuseStart: '10:00' }).ok, false);
    assert.equal(normalizeTimeExcuse({ excuseReason: 'holiday' }).ok, false);
  });
});

describe('calendar helpers', () => {
  it('adds days across month end and counts span', () => {
    assert.equal(addDaysIso('2026-09-30', 1), '2026-10-01');
    assert.equal(shiftIsoDay('2026-03-01', -1), '2026-02-28');
    assert.equal(daySpan('2026-09-01', '2026-09-30'), 29);
  });

  it('Mon–Fri are workdays', () => {
    assert.equal(isWorkdayIso('2026-09-28'), true);
    assert.equal(isWorkdayIso('2026-09-27'), false);
  });

  it('isDayInLocks checks inclusive ranges', () => {
    const locks = [{ periodStart: '2026-08-01', periodEnd: '2026-08-31' }];
    assert.equal(isDayInLocks('2026-08-31', locks), true);
    assert.equal(isDayInLocks('2026-09-01', locks), false);
  });
});

describe('time-clock-format', () => {
  it('formats signed clock minutes', () => {
    assert.equal(formatMinutesClock(6), '00:06');
    assert.equal(formatMinutesClock(-997), '-16:37');
    assert.equal(formatMinutesHm(65), '1h05');
  });

  it('period presets', () => {
    assert.deepEqual(timeClockPeriodFor('7', '2026-10-02'), { from: '2026-09-26', to: '2026-10-02' });
    assert.deepEqual(timeClockPeriodFor('30', '2026-10-02'), { from: '2026-09-03', to: '2026-10-02' });
    assert.deepEqual(timeClockPeriodFor('month', '2026-10-02'), { from: '2026-10-01', to: '2026-10-02' });
    assert.deepEqual(timeClockPeriodFor('prevMonth', '2026-03-15'), { from: '2026-02-01', to: '2026-02-28' });
  });

  it('HH:mm in a zone and spans', () => {
    assert.equal(hmInZone('2026-09-28T12:05:00Z', 'America/Sao_Paulo'), '09:05');
    assert.equal(hmInZone('nope', 'UTC'), '');
    assert.equal(hmSpanMinutes('13:00', '14:45'), 105);
    assert.equal(hmSpanMinutes('14:00', '13:00'), 0);
  });
});
