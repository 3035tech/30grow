import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_CLOCK_REASON,
  isTimeClockEnabledFor,
  normalizeTimeClockOverride,
  resolveTimeClockEligibility,
  timeClockEnabledSql,
} from '../../lib/people/time-clock-eligibility.js';
import { employeeSectionVisible } from '../../lib/company/company-modules.js';
import { WORK_FORMAT } from '../../lib/domain-status.js';

test('default follows work format: clt/intern/unset on, pj/cooperative off', () => {
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.CLT }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.INTERN }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: null }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.PJ }), false);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.COOPERATIVE }), false);
  assert.equal(isTimeClockEnabledFor({ workFormat: ' PJ ' }), false);
});

test('boolean override wins over work format and reports the reason', () => {
  assert.deepEqual(resolveTimeClockEligibility({ workFormat: WORK_FORMAT.PJ, override: true }), {
    enabled: true,
    reason: TIME_CLOCK_REASON.OVERRIDE,
  });
  assert.deepEqual(resolveTimeClockEligibility({ workFormat: WORK_FORMAT.CLT, override: false }), {
    enabled: false,
    reason: TIME_CLOCK_REASON.OVERRIDE,
  });
  assert.equal(resolveTimeClockEligibility({ workFormat: WORK_FORMAT.PJ, override: null }).reason, TIME_CLOCK_REASON.WORK_FORMAT);
});

test('normalizeTimeClockOverride accepts tri-state and rejects junk', () => {
  assert.equal(normalizeTimeClockOverride(null), null);
  assert.equal(normalizeTimeClockOverride(''), null);
  assert.equal(normalizeTimeClockOverride('auto'), null);
  assert.equal(normalizeTimeClockOverride(true), true);
  assert.equal(normalizeTimeClockOverride('true'), true);
  assert.equal(normalizeTimeClockOverride(false), false);
  assert.equal(normalizeTimeClockOverride('false'), false);
  assert.equal(normalizeTimeClockOverride('enabled'), undefined);
  assert.equal(normalizeTimeClockOverride(1), undefined);
});

test('SQL expression is a COALESCE over override and work format', () => {
  const sql = timeClockEnabledSql('x');
  assert.match(sql, /COALESCE\(x\.time_clock_override,/);
  assert.match(sql, /'pj', 'cooperative'/);
});

test('employeeSectionVisible hides time clock only when explicitly disabled', () => {
  assert.equal(employeeSectionVisible(null, 'timeClock', { timeClockEnabled: false }), false);
  assert.equal(employeeSectionVisible(null, 'timeClock', { timeClockEnabled: true }), true);
  assert.equal(employeeSectionVisible(null, 'timeClock', {}), true);
  assert.equal(employeeSectionVisible(['core'], 'timeClock', { timeClockEnabled: true }), false);
  assert.equal(employeeSectionVisible(null, 'dp', { timeClockEnabled: false }), true);
});
