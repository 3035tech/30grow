/**
 * Per-collaborator time clock eligibility (migration 185).
 * Only CLT, interns, and trainees are included in time tracking.
 * Pure module: safe for client components and unit tests.
 */
import { WORK_FORMAT } from '../domain-status.js';

export const WORK_FORMATS_WITH_TIME_CLOCK = Object.freeze([
  WORK_FORMAT.CLT,
  WORK_FORMAT.INTERN,
  WORK_FORMAT.TRAINEE,
]);

export const TIME_CLOCK_REASON = Object.freeze({
  WORK_FORMAT: 'work_format',
  // Retained for old audit records and callers; eligibility no longer permits overrides.
  OVERRIDE: 'override',
});

/** @returns {null|boolean|undefined} undefined = invalid input */
export function normalizeTimeClockOverride(raw) {
  if (raw == null || raw === '' || raw === 'auto') return null;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return undefined;
}

export function timeClockDefaultForWorkFormat(workFormat) {
  const wf = workFormat == null ? '' : String(workFormat).trim().toLowerCase();
  return WORK_FORMATS_WITH_TIME_CLOCK.includes(wf);
}

/** @returns {{ enabled: boolean, reason: string }} */
export function resolveTimeClockEligibility({ workFormat, override } = {}) {
  // Keep accepting legacy override values at call sites, but the allowed work
  // formats now define point eligibility consistently across the product.
  return { enabled: timeClockDefaultForWorkFormat(workFormat), reason: TIME_CLOCK_REASON.WORK_FORMAT };
}

export function isTimeClockEnabledFor(input) {
  return resolveTimeClockEligibility(input).enabled;
}

/** SQL boolean expression equivalent to isTimeClockEnabledFor (alias = candidates table alias). */
export function timeClockEnabledSql(alias = 'c') {
  const allowed = WORK_FORMATS_WITH_TIME_CLOCK.map((f) => `'${f}'`).join(', ');
  return `COALESCE(${alias}.work_format, '') IN (${allowed})`;
}
