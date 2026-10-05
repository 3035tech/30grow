/**
 * Pure per-day time clock math (no DB): calendar helpers, worked/expected minutes and
 * the day summary used by the mirror, the collaborator history and the hour bank.
 */

import {
  COMPANY_WORKDAYS,
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_REVIEW,
  TIME_SCHEDULE_SOURCE,
} from '../domain-status.js';

export const DEFAULT_DAY_SCHEDULE = Object.freeze({
  workdayStart: '09:00',
  workdayEnd: '18:00',
  breakMinutes: 60,
  lateGraceMinutes: 10,
  timezone: 'America/Sao_Paulo',
  weekdays: COMPANY_WORKDAYS,
});

export function parseIsoDay(raw) {
  const s = String(raw || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daySpan(from, to) {
  return Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000
  );
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Workday by the schedule's weekdays (company default Mon–Fri). */
export function isWorkdayIso(iso, weekdays = COMPANY_WORKDAYS) {
  return (weekdays || COMPANY_WORKDAYS).includes(weekdayOf(iso));
}

export function hmToMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Company default as a day schedule (Mon–Fri, break in minutes). */
export function companyDaySchedule(companySchedule) {
  const c = companySchedule || DEFAULT_DAY_SCHEDULE;
  return {
    workdayStart: c.workdayStart || DEFAULT_DAY_SCHEDULE.workdayStart,
    workdayEnd: c.workdayEnd || DEFAULT_DAY_SCHEDULE.workdayEnd,
    breakMinutes: Number(c.breakMinutes) || 0,
    breakStart: null,
    breakEnd: null,
    lateGraceMinutes: Number(c.lateGraceMinutes) || 0,
    timezone: c.timezone || DEFAULT_DAY_SCHEDULE.timezone,
    weekdays: COMPANY_WORKDAYS,
    source: TIME_SCHEDULE_SOURCE.COMPANY,
  };
}

/**
 * Effective schedule on `iso`: latest employee row with validFrom <= iso, unless it
 * follows the company. `rows` sorted by validFrom ascending.
 */
export function resolveDaySchedule(companySchedule, rows, iso) {
  let current = null;
  for (const row of rows || []) {
    if (row.validFrom <= iso) current = row;
    else break;
  }
  const base = companyDaySchedule(companySchedule);
  if (!current || current.followsCompany) return base;
  const brk = current.breakStart && current.breakEnd
    ? (hmToMinutes(current.breakEnd) ?? 0) - (hmToMinutes(current.breakStart) ?? 0)
    : 0;
  return {
    ...base,
    workdayStart: current.workdayStart,
    workdayEnd: current.workdayEnd,
    breakMinutes: Math.max(0, brk),
    breakStart: current.breakStart,
    breakEnd: current.breakEnd,
    weekdays: current.weekdays,
    source: TIME_SCHEDULE_SOURCE.EMPLOYEE,
  };
}

/** Expected net worked minutes for a scheduled day (start→end minus break). */
export function expectedNetMinutes(schedule) {
  const sched = schedule || DEFAULT_DAY_SCHEDULE;
  const span = (hmToMinutes(sched.workdayEnd) ?? 0) - (hmToMinutes(sched.workdayStart) ?? 0);
  const brk = Math.max(0, Number(sched.breakMinutes) || 0);
  return Math.max(0, span - brk);
}

/** Sum paired in→out intervals (minutes). Unpaired trailing IN is ignored. */
export function pairWorkedMinutes(punches = []) {
  const ordered = [...(punches || [])].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  let total = 0;
  let openIn = null;
  for (const p of ordered) {
    const kind = String(p.punchKind || '').toLowerCase();
    const t = new Date(p.punchedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (kind === TIME_PUNCH_KIND.IN) {
      openIn = t;
      continue;
    }
    if (kind === TIME_PUNCH_KIND.OUT && openIn != null) {
      const mins = Math.round((t - openIn) / 60000);
      if (mins > 0) total += mins;
      openIn = null;
    }
  }
  return total;
}

function hasUnpairedPunches(active) {
  let expect = TIME_PUNCH_KIND.IN;
  for (const p of active) {
    if (p.punchKind !== expect) return true;
    expect = expect === TIME_PUNCH_KIND.IN ? TIME_PUNCH_KIND.OUT : TIME_PUNCH_KIND.IN;
  }
  return expect === TIME_PUNCH_KIND.OUT;
}

/** Minutes covered by a partial excuse; null = whole day (or no interval). */
export function excusedIntervalMinutes(justification) {
  const start = hmToMinutes(justification?.excusedStart);
  const end = hmToMinutes(justification?.excusedEnd);
  if (start == null || end == null || end <= start) return null;
  return end - start;
}

/**
 * Pure per-day summary. Tolerance = schedule.lateGraceMinutes (daily band where
 * small differences count as neither extra nor missing). A whole-day justification
 * clears missing hours; an interval only discounts its own length. A holiday has no
 * expected hours (worked time counts as extra).
 */
export function summarizeTimeDay({
  punches = [],
  schedule = DEFAULT_DAY_SCHEDULE,
  justification = null,
  isWorkday = true,
  isToday = false,
  beforeStart = false,
  holiday = null,
}) {
  const ordered = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  const active = ordered.filter((p) => !p.voidedAt);
  const worked = pairWorkedMinutes(active);
  const expected = isWorkday && !beforeStart && !holiday ? expectedNetMinutes(schedule) : 0;
  const tol = Math.max(0, Number(schedule?.lateGraceMinutes) || 0);
  const diff = worked - expected;
  const excused = justification ? excusedIntervalMinutes(justification) : null;
  const wholeDayExcuse = Boolean(justification) && excused == null;
  let extraMinutes = 0;
  let missingMinutes = 0;
  if (diff > tol) extraMinutes = diff;
  else if (-diff > tol && !isToday && !wholeDayExcuse) {
    const left = -diff - (excused || 0);
    missingMinutes = left > tol ? left : 0;
  }

  const last = active[active.length - 1];
  const unpaired = hasUnpairedPunches(active);
  let occurrence = TIME_DAY_OCCURRENCE.OK;
  if (justification && missingMinutes === 0) occurrence = TIME_DAY_OCCURRENCE.JUSTIFIED;
  else if (isToday && last?.punchKind === TIME_PUNCH_KIND.IN) occurrence = TIME_DAY_OCCURRENCE.IN_PROGRESS;
  else if (unpaired && !isToday) occurrence = TIME_DAY_OCCURRENCE.INCOMPLETE;
  else if (active.some((p) => p.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED)) {
    occurrence = TIME_DAY_OCCURRENCE.REVIEW;
  } else if (active.length === 0 && holiday) occurrence = TIME_DAY_OCCURRENCE.HOLIDAY;
  else if (active.length === 0 && isToday) occurrence = TIME_DAY_OCCURRENCE.TODAY;
  else if (active.length === 0 && (!isWorkday || beforeStart)) occurrence = TIME_DAY_OCCURRENCE.REST;
  else if (active.length === 0) occurrence = TIME_DAY_OCCURRENCE.ABSENCE;
  else if (missingMinutes > 0) occurrence = TIME_DAY_OCCURRENCE.MISSING;

  return {
    workedMinutes: worked,
    expectedMinutes: expected,
    extraMinutes,
    missingMinutes,
    occurrence,
    activeCount: active.length,
    voidedCount: ordered.length - active.length,
  };
}

/**
 * One hour-bank step: the day's net (extra − missing) plus approved manual minutes,
 * capped at the company maximum (excess is not banked). No floor: negative = owed hours.
 */
export function stepHourBank(balance, { net = 0, manual = 0, cap = null }) {
  const raw = balance + net + manual;
  if (cap == null || raw <= cap) return { balance: raw, overCap: 0 };
  const next = Math.max(cap, Math.min(balance, raw));
  return { balance: next, overCap: raw - next };
}
