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
  const s = String(raw || '')
    .trim()
    .slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s
    ? null
    : s;
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daySpan(from, to) {
  return Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() -
      new Date(`${from}T12:00:00Z`).getTime()) /
      86400000,
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
  const m = /^(\d{1,2}):(\d{2})(?::[0-5]\d)?$/.exec(String(hm || ''));
  return m && Number(m[1]) < 24 && Number(m[2]) < 60
    ? Number(m[1]) * 60 + Number(m[2])
    : null;
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
    hourBankEnabled: c.hourBankEnabled,
    hourBankMaxMinutes: c.hourBankMaxMinutes,
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
  const brk =
    current.breakStart && current.breakEnd
      ? ((hmToMinutes(current.breakEnd) ?? 0) -
          (hmToMinutes(current.breakStart) ?? 0) +
          1440) %
        1440
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
    shiftPattern: current.shiftPattern || 'weekly',
    cycleAnchor: current.cycleAnchor || null,
    nightRule: current.nightRule || 'none',
  };
}

/** Expected net worked minutes for a scheduled day (start→end minus break). */
export function expectedNetMinutes(schedule) {
  const sched = schedule || DEFAULT_DAY_SCHEDULE;
  const span =
    ((hmToMinutes(sched.workdayEnd) ?? 0) -
      (hmToMinutes(sched.workdayStart) ?? 0) +
      1440) %
    1440;
  const brk = Math.max(0, Number(sched.breakMinutes) || 0);
  return Math.max(0, span - brk);
}

/** Sum paired in→out intervals (minutes). Unpaired trailing IN is ignored. */
export function pairWorkedMinutes(punches = []) {
  const ordered = [...(punches || [])].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime(),
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
      const elapsed = t - openIn;
      if (elapsed > 0) total += elapsed;
      openIn = null;
    }
  }
  return Math.round(total / 60000);
}

function hasUnpairedPunches(active) {
  let expect = TIME_PUNCH_KIND.IN;
  for (const p of active) {
    if (p.punchKind !== expect) return true;
    expect =
      expect === TIME_PUNCH_KIND.IN ? TIME_PUNCH_KIND.OUT : TIME_PUNCH_KIND.IN;
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

/** Credit only scheduled excuse time not already worked; exclude the explicit break. */
function partialExcuseCredit(justification, schedule, active) {
  const start = hmToMinutes(schedule.workdayStart),
    rawEnd = hmToMinutes(schedule.workdayEnd);
  const rawFrom = hmToMinutes(justification?.excusedStart),
    rawTo = hmToMinutes(justification?.excusedEnd);
  if (
    [start, rawEnd, rawFrom, rawTo].some((v) => v == null) ||
    start === rawEnd
  )
    return { minutes: 0, review: true };
  const overnight = rawEnd < start,
    offset = (v) => v + (overnight && v < start ? 1440 : 0);
  const end = offset(rawEnd),
    from = offset(rawFrom),
    to = offset(rawTo);
  if (to <= from) return { minutes: 0, review: true };
  const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));
  if (!overlap(from, to, start, end)) return { minutes: 0, review: false };
  const rawBs = hmToMinutes(schedule.breakStart),
    rawBe = hmToMinutes(schedule.breakEnd);
  const bs = rawBs == null ? null : offset(rawBs),
    be = rawBe == null ? null : offset(rawBe);
  const hasBreak = Number(schedule.breakMinutes) > 0;
  if (
    hasBreak &&
    (bs == null || be == null || bs < start || be > end || be <= bs)
  )
    return { minutes: 0, review: true };
  const segments = hasBreak
    ? [
        [start, bs],
        [be, end],
      ]
    : [[start, end]];
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone || DEFAULT_DAY_SCHEDULE.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const minute = (value) => {
    const parts = formatter.formatToParts(new Date(value));
    const get = (type) =>
      Number(parts.find((p) => p.type === type)?.value || 0);
    return offset(get('hour') * 60 + get('minute') + get('second') / 60);
  };
  let credit = 0;
  for (const [a, b] of segments) {
    const left = Math.max(from, a),
      right = Math.min(to, b);
    if (right <= left) continue;
    let worked = 0,
      open = null;
    for (const p of active) {
      if (p.punchKind === TIME_PUNCH_KIND.IN) open = minute(p.punchedAt);
      else if (open !== null) {
        worked += overlap(open, minute(p.punchedAt), left, right);
        open = null;
      }
    }
    credit += Math.max(0, right - left - worked);
  }
  return { minutes: Math.round(credit), review: false };
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
  historyReview = false,
}) {
  const ordered = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime(),
  );
  const active = ordered.filter((p) => !p.voidedAt);
  const worked = pairWorkedMinutes(active);
  const expected =
    isWorkday && !beforeStart && (!holiday || schedule.shiftPattern === '12x36')
      ? expectedNetMinutes(schedule)
      : 0;
  const tol = Math.max(0, Number(schedule?.lateGraceMinutes) || 0);
  const diff = worked - expected;
  const hasPartial = Boolean(
    justification?.excusedStart || justification?.excusedEnd,
  );
  const partial = hasPartial
    ? partialExcuseCredit(justification, schedule, active)
    : { minutes: 0, review: false };
  const excused = partial.minutes;
  const wholeDayExcuse = Boolean(justification) && !hasPartial;
  const invalidSchedule =
    isWorkday &&
    !beforeStart &&
    !holiday &&
    (hmToMinutes(schedule.workdayEnd) == null ||
      hmToMinutes(schedule.workdayStart) == null ||
      schedule.workdayEnd === schedule.workdayStart ||
      Number(schedule.breakMinutes) >=
        ((hmToMinutes(schedule.workdayEnd) ?? 0) -
          (hmToMinutes(schedule.workdayStart) ?? 0) +
          1440) %
          1440);
  const requiresScheduleReview =
    partial.review || invalidSchedule || historyReview;
  let extraMinutes = 0;
  let missingMinutes = 0;
  if (diff > tol) extraMinutes = diff;
  else if (-diff > tol && !isToday && !wholeDayExcuse) {
    const left = -diff - (excused || 0);
    missingMinutes = left > tol ? left : 0;
  }

  if (historyReview) {
    extraMinutes = 0;
    missingMinutes = 0;
  }
  const last = active[active.length - 1];
  const unpaired = hasUnpairedPunches(active);
  let occurrence = TIME_DAY_OCCURRENCE.OK;
  if (isToday && last?.punchKind === TIME_PUNCH_KIND.IN)
    occurrence = TIME_DAY_OCCURRENCE.IN_PROGRESS;
  else if (unpaired && !isToday) occurrence = TIME_DAY_OCCURRENCE.INCOMPLETE;
  else if (
    requiresScheduleReview ||
    active.some((p) => p.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED)
  ) {
    occurrence = TIME_DAY_OCCURRENCE.REVIEW;
  } else if (justification && missingMinutes === 0)
    occurrence = TIME_DAY_OCCURRENCE.JUSTIFIED;
  else if (active.length === 0 && holiday && expected === 0)
    occurrence = TIME_DAY_OCCURRENCE.HOLIDAY;
  else if (active.length === 0 && isToday)
    occurrence = TIME_DAY_OCCURRENCE.TODAY;
  else if (active.length === 0 && (!isWorkday || beforeStart))
    occurrence = TIME_DAY_OCCURRENCE.REST;
  else if (active.length === 0) occurrence = TIME_DAY_OCCURRENCE.ABSENCE;
  else if (missingMinutes > 0) occurrence = TIME_DAY_OCCURRENCE.MISSING;

  return {
    workedMinutes: worked,
    ...nightTimeMinutes(active, schedule),
    expectedMinutes: expected,
    extraMinutes,
    missingMinutes,
    occurrence,
    activeCount: active.length,
    voidedCount: ordered.length - active.length,
    requiresScheduleReview,
    incomplete: unpaired && !isToday,
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

/** Physical night minutes and urban reduced-hour equivalent; no salary computation. */
export function nightTimeMinutes(punches, schedule) {
  if (schedule?.nightRule !== 'urban_clt')
    return { nightMinutes: 0, nightEquivalentMinutes: 0 };
  const ordered = [...punches]
    .filter((p) => !p.voidedAt)
    .sort((a, b) => new Date(a.punchedAt) - new Date(b.punchedAt));
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone || DEFAULT_DAY_SCHEDULE.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const isNight = (at) => {
    const hour = Number(
      formatter.formatToParts(new Date(at)).find((p) => p.type === 'hour')
        .value,
    );
    return hour >= 22 || hour < 5;
  };
  let open = null,
    milliseconds = 0;
  for (const punch of ordered) {
    const at = new Date(punch.punchedAt).getTime();
    if (punch.punchKind === 'in') {
      open = at;
      continue;
    }
    if (open === null) continue;
    // Classify stable 15-minute windows; inspect minute boundaries only where the
    // night band changes (including a timezone transition). Count real elapsed time.
    if (at > open && at - open <= 86400000) {
      for (let t = open; t < at;) {
        const end = Math.min(at, Math.floor(t / 900000) * 900000 + 900000);
        const first = isNight(t),
          last = isNight(end - 1);
        if (first === last) {
          if (first) milliseconds += end - t;
        } else
          for (let minute = t; minute < end;) {
            const next = Math.min(
              end,
              Math.floor(minute / 60000) * 60000 + 60000,
            );
            if (isNight(minute)) milliseconds += next - minute;
            minute = next;
          }
        t = end;
      }
    }
    open = null;
  }
  return {
    nightMinutes: Math.round(milliseconds / 60000),
    nightEquivalentMinutes: Math.round(milliseconds / 52500),
  };
}

/** A past civil day may still have an unfinished overnight contractual shift. */
export function shiftStillOpen(day, schedule, now = new Date()) {
  const end = hmToMinutes(schedule.workdayEnd),
    start = hmToMinutes(schedule.workdayStart);
  if (end == null || start == null) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone || DEFAULT_DAY_SCHEDULE.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type).value;
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  const finalDay = end < start ? addDaysIso(day, 1) : day;
  return (
    today < finalDay ||
    (today === finalDay &&
      Number(value('hour')) * 60 + Number(value('minute')) < end)
  );
}
