/**
 * B-2722 hour bank pure helpers (offline).
 * Run: node --test test/unit/hour-bank.unit.test.js
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIME_PUNCH_KIND } from '../../lib/domain-status.js';
import { hourBankDayNet } from '../../lib/people/hour-bank-balance.js';
import { hourBankParticipantOn } from '../../lib/people/hour-bank-participation.js';
import { stepHourBank, summarizeTimeDay } from '../../lib/people/time-day-summary.js';
import {
  expectedNetMinutes,
  formatMinutesHm,
  overtimeMinutes,
  pairWorkedMinutes,
} from '../../lib/people/hour-bank.js';

describe('expectedNetMinutes', () => {
  it('subtracts break from span', () => {
    assert.equal(
      expectedNetMinutes({
        workdayStart: '09:00',
        workdayEnd: '18:00',
        breakMinutes: 60,
      }),
      480
    );
  });
});

describe('pairWorkedMinutes', () => {
  it('sums in→out pairs', () => {
    const mins = pairWorkedMinutes([
      { punchKind: TIME_PUNCH_KIND.IN, punchedAt: '2030-01-01T12:00:00.000Z' },
      { punchKind: TIME_PUNCH_KIND.OUT, punchedAt: '2030-01-01T21:00:00.000Z' },
    ]);
    assert.equal(mins, 540);
  });

  it('ignores trailing open IN', () => {
    const mins = pairWorkedMinutes([
      { punchKind: TIME_PUNCH_KIND.IN, punchedAt: '2030-01-01T12:00:00.000Z' },
      { punchKind: TIME_PUNCH_KIND.OUT, punchedAt: '2030-01-01T13:00:00.000Z' },
      { punchKind: TIME_PUNCH_KIND.IN, punchedAt: '2030-01-01T14:00:00.000Z' },
    ]);
    assert.equal(mins, 60);
  });
});

describe('overtimeMinutes', () => {
  it('returns 0 below threshold', () => {
    assert.equal(
      overtimeMinutes(490, {
        workdayStart: '09:00',
        workdayEnd: '18:00',
        breakMinutes: 60,
      }),
      0
    );
  });

  it('returns overtime when ≥15 over expected', () => {
    assert.equal(
      overtimeMinutes(500, {
        workdayStart: '09:00',
        workdayEnd: '18:00',
        breakMinutes: 60,
      }),
      20
    );
  });
});

describe('missed workday balance', () => {
  it('debits a past workday with no punches', () => {
    const summary = summarizeTimeDay({
      punches: [],
      schedule: {
        workdayStart: '09:00', workdayEnd: '18:00', breakMinutes: 60,
        lateGraceMinutes: 5,
      },
      isWorkday: true,
      isToday: false,
    });
    assert.equal(summary.missingMinutes, 480);
    assert.equal(stepHourBank(0, { net: hourBankDayNet(summary, true), cap: 2400 }).balance, -480);
  });
});

describe('individual time bank participation', () => {
  it('follows the company until an individual exclusion and preserves date transitions', () => {
    const choices = [
      { validFrom: '2026-11-01', enabled: false },
      { validFrom: '2026-12-01', enabled: true },
    ];
    assert.equal(hourBankParticipantOn([], '2026-11-01'), true);
    assert.equal(hourBankParticipantOn(choices, '2026-10-31'), true);
    assert.equal(hourBankParticipantOn(choices, '2026-11-01'), false);
    assert.equal(hourBankDayNet({ extraMinutes: 30, missingMinutes: 480 }, hourBankParticipantOn(choices, '2026-11-15')), 0);
    assert.equal(hourBankParticipantOn(choices, '2026-12-01'), true);
  });
});

describe('formatMinutesHm', () => {
  it('formats hours and minutes', () => {
    assert.equal(formatMinutesHm(125), '2h05');
    assert.equal(formatMinutesHm(-30), '-0h30');
  });
});
