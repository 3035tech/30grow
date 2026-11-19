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

test('only CLT, intern, and trainee work formats enable the time clock', () => {
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.CLT }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.INTERN }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.TRAINEE }), true);
  assert.equal(isTimeClockEnabledFor({ workFormat: null }), false);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.PJ }), false);
  assert.equal(isTimeClockEnabledFor({ workFormat: WORK_FORMAT.COOPERATIVE }), false);
  assert.equal(isTimeClockEnabledFor({ workFormat: ' PJ ' }), false);
});

test('legacy boolean overrides do not change format-based eligibility', () => {
  assert.deepEqual(resolveTimeClockEligibility({ workFormat: WORK_FORMAT.PJ, override: true }), {
    enabled: false,
    reason: TIME_CLOCK_REASON.WORK_FORMAT,
  });
  assert.deepEqual(resolveTimeClockEligibility({ workFormat: WORK_FORMAT.CLT, override: false }), {
    enabled: true,
    reason: TIME_CLOCK_REASON.WORK_FORMAT,
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

test('SQL expression permits only listed work formats', () => {
  const sql = timeClockEnabledSql('x');
  assert.equal(sql, "COALESCE(x.work_format, '') IN ('clt', 'intern', 'trainee')");
});

test('employeeSectionVisible hides time clock only when explicitly disabled', () => {
  assert.equal(employeeSectionVisible(null, 'timeClock', { timeClockEnabled: false }), false);
  assert.equal(employeeSectionVisible(null, 'timeClock', { timeClockEnabled: true }), true);
  assert.equal(employeeSectionVisible(null, 'timeClock', {}), true);
  assert.equal(employeeSectionVisible(['core'], 'timeClock', { timeClockEnabled: true }), false);
  assert.equal(employeeSectionVisible(null, 'dp', { timeClockEnabled: false }), true);
});
