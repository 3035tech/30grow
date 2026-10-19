/** Closing checks reuse the same batched calendar and daily engine as frozen mirrors. */
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { TIME_DAY_OCCURRENCE, TIME_PUNCH_REVIEW } from '../domain-status.js';
import {
  DEFAULT_SCHEDULE,
  getCompanyTimeSchedule,
  isoDayInTz,
} from './time-clock.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';
import {
  HOUR_BANK_BATCH,
  listClosureScopePeople,
  loadTimeDayInputs,
} from './hour-bank-balance.js';
import {
  addDaysIso,
  daySpan,
  parseIsoDay,
  summarizeTimeDay,
  shiftStillOpen,
} from './time-day-summary.js';

export const TIME_CLOSING_MAX_DAYS = 93;
export const TIME_CLOSING_PEOPLE_CAP = 5000;
export function validClosingPeriod(from, to, today) {
  return (
    parseIsoDay(from) === from &&
    parseIsoDay(to) === to &&
    from <= to &&
    to < today &&
    daySpan(from, to) < TIME_CLOSING_MAX_DAYS
  );
}
export async function getTimeClosingReadiness(
  dbOrQuery,
  {
    companyId,
    periodStart,
    periodEnd,
    orgUnitId = null,
    sequential = false,
    schedule = null,
  },
) {
  const db = asDb(dbOrQuery),
    cid = Number(companyId),
    unit = orgUnitId == null || orgUnitId === '' ? null : Number(orgUnitId);
  if (!Number.isSafeInteger(cid) || cid <= 0)
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (unit !== null && (!Number.isSafeInteger(unit) || unit <= 0))
    return { ok: false, errorCode: ERR.INVALID_DATA };
  const sched =
    schedule ||
    (await getCompanyTimeSchedule(db, { companyId: cid })).schedule ||
    DEFAULT_SCHEDULE;
  const today = isoDayInTz(new Date(), sched.timezone);
  if (!validClosingPeriod(periodStart, periodEnd, today))
    return { ok: false, errorCode: ERR.INVALID_DATE };
  if (
    unit !== null &&
    !(
      await db.query(
        'SELECT id FROM org_units WHERE company_id=$1 AND id=$2 AND active=TRUE',
        [cid, unit],
      )
    ).rowCount
  )
    return { ok: false, errorCode: ERR.NOT_FOUND };
  const overlap = await db.query(
    `WITH RECURSIVE related AS (
 SELECT id,parent_id FROM org_units WHERE company_id=$1 AND id=$4::int
 UNION SELECT u.id,u.parent_id FROM org_units u JOIN related r ON u.parent_id=r.id WHERE u.company_id=$1
 ), ancestors AS (
 SELECT id,parent_id FROM org_units WHERE company_id=$1 AND id=$4::int
 UNION SELECT u.id,u.parent_id FROM org_units u JOIN ancestors a ON u.id=a.parent_id WHERE u.company_id=$1
 ) SELECT id FROM time_clock_closures WHERE company_id=$1 AND status='closed' AND period_start<=$3::date AND period_end>=$2::date AND (org_unit_id IS NULL OR $4::int IS NULL OR org_unit_id IN (SELECT id FROM related) OR org_unit_id IN (SELECT id FROM ancestors) OR EXISTS(SELECT 1 FROM time_clock_closure_people frozen JOIN candidates c ON c.id=frozen.candidate_id AND c.company_id=frozen.company_id WHERE frozen.closure_id=time_clock_closures.id AND frozen.company_id=$1 AND c.org_unit_id IN (SELECT id FROM related))) LIMIT 1`,
    [cid, periodStart, periodEnd, unit],
  );
  if (overlap.rowCount)
    return {
      ok: true,
      periodStart,
      periodEnd,
      orgUnitId: unit,
      closed: true,
      ready: false,
      totals: { people: 0, blockedPeople: 0 },
      items: [],
    };
  const people = await listClosureScopePeople(db, {
    companyId: cid,
    orgUnitId: unit,
    periodStart,
    periodEnd,
    limit: TIME_CLOSING_PEOPLE_CAP + 1,
  });
  if (people.length > TIME_CLOSING_PEOPLE_CAP)
    return { ok: false, errorCode: ERR.TIME_CLOCK_CLOSURE_LIMIT };
  const eligible = people;
  const items = [];
  for (let offset = 0; offset < eligible.length; offset += HOUR_BANK_BATCH) {
    const chunk = eligible.slice(offset, offset + HOUR_BANK_BATCH),
      ids = chunk.map((p) => p.id);
    const inputs = await loadTimeDayInputs(db, {
      companyId: cid,
      candidateIds: ids,
      from: periodStart,
      to: periodEnd,
      timezone: sched.timezone,
      sequential,
    });
    const pending = new Map(ids.map((id) => [id, { requests: 0, bank: 0 }]));
    // One query per batch; every branch remains tenant scoped.
    const rows = await db.query(
      `SELECT candidate_id AS "candidateId",'requests' AS kind,count(*)::int AS n FROM employee_time_requests WHERE company_id=$1 AND candidate_id=ANY($2::bigint[]) AND work_on BETWEEN $3::date AND $4::date AND status='pending' GROUP BY candidate_id
   UNION ALL SELECT candidate_id AS "candidateId",'bank' AS kind,count(*)::int AS n FROM employee_hour_bank_entries WHERE company_id=$1 AND candidate_id=ANY($2::bigint[]) AND work_on BETWEEN $3::date AND $4::date AND status='pending' GROUP BY candidate_id`,
      [cid, ids, periodStart, periodEnd],
    );
    for (const r of rows.rows || [])
      pending.get(Number(r.candidateId))[r.kind] = Number(r.n);
    for (const person of chunk) {
      const counts = {
        incompleteDays: 0,
        reviewDays: 0,
        scheduleReviewDays: 0,
        absenceDays: 0,
        missingMinutes: 0,
        extraMinutes: 0,
      };
      let covered = false;
      const days = [],
        calendar = inputs.calendarFor(sched, person, { orgUnitId: unit });
      for (let day = periodStart; day <= periodEnd; day = addDaysIso(day, 1)) {
        const info = calendar(day),
          punches = inputs.punches.get(`${person.id}|${day}`) || [];
        if (info.inScope === false) continue;
        if (info.employed && info.enabled) covered = true;
        const summary = summarizeTimeDay({
          punches,
          schedule: info.schedule,
          justification: inputs.justs.get(`${person.id}|${day}`),
          isWorkday: info.isWorkday,
          holiday: info.holiday,
          historyReview: info.requiresHistoryReview,
          beforeStart: info.employed === false,
        });
        const ongoing =
          day >= addDaysIso(today, -2) &&
          info.isWorkday &&
          (!info.holiday || info.schedule.shiftPattern === '12x36') &&
          shiftStillOpen(day, info.schedule);
        if (ongoing) counts.reviewDays++;
        if (summary.incomplete) counts.incompleteDays++;
        if (punches.some((p) => p.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED))
          counts.reviewDays++;
        if (summary.requiresScheduleReview) counts.scheduleReviewDays++;
        if (summary.occurrence === TIME_DAY_OCCURRENCE.ABSENCE)
          counts.absenceDays++;
        counts.missingMinutes += summary.missingMinutes;
        counts.extraMinutes += summary.extraMinutes;
        if (
          ongoing ||
          summary.incomplete ||
          summary.requiresScheduleReview ||
          summary.occurrence === TIME_DAY_OCCURRENCE.REVIEW ||
          summary.missingMinutes > 0
        )
          days.push({
            day,
            occurrence: summary.occurrence,
            requiresScheduleReview: summary.requiresScheduleReview,
          });
      }
      if (!covered) continue;
      const p = pending.get(person.id);
      items.push({
        candidateId: person.id,
        fullName: person.fullName,
        email: person.email,
        ...counts,
        pendingRequests: p.requests,
        pendingBank: p.bank,
        blocked: Boolean(
          counts.incompleteDays ||
          counts.reviewDays ||
          counts.scheduleReviewDays ||
          p.requests ||
          p.bank,
        ),
        days,
      });
    }
  }
  const keys = [
    'incompleteDays',
    'reviewDays',
    'scheduleReviewDays',
    'absenceDays',
    'missingMinutes',
    'extraMinutes',
    'pendingRequests',
    'pendingBank',
  ];
  const totals = {
    people: items.length,
    blockedPeople: items.filter((p) => p.blocked).length,
    ...Object.fromEntries(
      keys.map((key) => [key, items.reduce((n, p) => n + p[key], 0)]),
    ),
  };
  return {
    ok: true,
    periodStart,
    periodEnd,
    orgUnitId: unit,
    closed: false,
    totals,
    ready: items.length > 0 && totals.blockedPeople === 0,
    items,
  };
}
