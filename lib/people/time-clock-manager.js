/**
 * Manager view of the time clock: people list, per-person mirror by period,
 * adjustments (void + insert, never edit), day justification and period closures.
 */

import { asDb } from '../ae/as-db.js';
import { withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { TIME_ADJUST_MAX_ADD, TIME_ADJUST_MAX_VOID } from '../time-clock-format.js';
import { ORG_UNIT } from '../org-unit-constants.js';
import {
  EMPLOYMENT_STATUS,
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_SOURCE,
  HOUR_BANK_STATUS,
  TIME_CLOCK_CLOSURE_STATUS,
  TIME_CLOCK_CLOSURE_STATUSES,
  TIME_DAY_JUSTIFICATIONS,
  TIME_DAY_OCCURRENCE,
  TIME_PUNCH_KIND,
  TIME_PUNCH_KINDS,
  TIME_PUNCH_REVIEW,
  TIME_PUNCH_SOURCE,
  TIME_REQUEST_EXCUSE_REASONS,
  TIME_REQUEST_STATUS,
} from '../domain-status.js';
import { resolveTimeClockEligibility, timeClockEnabledSql } from './time-clock-eligibility.js';
import { listTimeRequestsByDay } from './time-clock-request-rows.js';
import {
  DEFAULT_SCHEDULE,
  assertTimeDayOpen,
  createTimePunch,
  getCompanyTimeSchedule,
  isDayInLocks,
  isoDayInTz,
  listClosureLocksForCandidate,
} from './time-clock.js';
import {
  addDaysIso,
  daySpan,
  parseIsoDay,
  stepHourBank,
  summarizeTimeDay,
} from './time-day-summary.js';
import { loadOrgUnitPaths } from './org-units.js';
import { loadPersonCalendar } from './time-clock-calendar.js';
import {
  computeHourBankBalances,
  hourBankDayNet,
  hourBankStartedOn,
  loadSnapshotAnchors,
  snapshotHourBankForClosure,
} from './hour-bank-balance.js';

export const TIME_MIRROR_MAX_DAYS = 62;
export const TIME_MIRROR_PUNCH_CAP = TIME_MIRROR_MAX_DAYS * 16;
export const TIME_CLOCK_PEOPLE_PAGE_SIZE = 25;
export const TIME_CLOCK_CLOSURES_PAGE_SIZE = 20;
export { TIME_ADJUST_MAX_ADD, TIME_ADJUST_MAX_VOID };

const fail = (errorCode) => ({ ok: false, errorCode });

export {
  addDaysIso,
  daySpan,
  excusedIntervalMinutes,
  isWorkdayIso,
  parseIsoDay,
  summarizeTimeDay,
} from './time-day-summary.js';

function clip(s, max = 500) {
  return String(s || '').trim().slice(0, max);
}

/**
 * Paginated employee list for the time clock, with flagged punches in the last 31 days.
 */
export async function listTimeClockPeople(dbOrQuery, {
  companyId,
  q = '',
  orgUnit = null,
  page = 1,
  pageSize = TIME_CLOCK_PEOPLE_PAGE_SIZE,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return fail(ERR.COMPANY_REQUIRED);
  const size = Math.min(50, Math.max(5, Number(pageSize) || TIME_CLOCK_PEOPLE_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid];
  let where = `c.company_id = $1 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`;
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(c.full_name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length})`;
  }
  if (orgUnit === ORG_UNIT.FILTER_NONE) {
    where += ' AND c.org_unit_id IS NULL';
  } else if (Number(orgUnit) > 0) {
    params.push(Number(orgUnit));
    where += ` AND c.org_unit_id = $${params.length}`;
  }
  const countRes = await db.query(`SELECT COUNT(*)::int AS n FROM candidates c WHERE ${where}`, params);
  const total = Number(countRes.rows[0]?.n) || 0;
  params.push(size, (pg - 1) * size);
  const r = await db.query(
    `SELECT c.id, c.full_name AS "fullName", c.email, c.org_unit_id AS "orgUnitId",
            c.work_format AS "workFormat", c.time_clock_override AS "timeClockOverride",
            jr.name AS "jobRoleName"
     FROM candidates c
     LEFT JOIN job_roles jr ON jr.id = c.job_role_id AND jr.company_id = c.company_id
     WHERE ${where}
     ORDER BY ${timeClockEnabledSql('c')} DESC, LOWER(c.full_name) ASC, c.id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const ids = (r.rows || []).map((row) => Number(row.id));
  const flagged = new Map();
  if (ids.length) {
    const f = await db.query(
      `SELECT candidate_id AS "candidateId", COUNT(*)::int AS n
       FROM employee_time_punches
       WHERE company_id = $1
         AND candidate_id = ANY($2::bigint[])
         AND review_status = '${TIME_PUNCH_REVIEW.FLAGGED}'
         AND voided_at IS NULL
         AND punched_at >= NOW() - INTERVAL '31 days'
       GROUP BY candidate_id`,
      [cid, ids]
    );
    for (const row of f.rows || []) flagged.set(Number(row.candidateId), Number(row.n));
  }
  const pathOf = await loadOrgUnitPaths(db, cid);
  return {
    ok: true,
    page: pg,
    pageSize: size,
    total,
    items: (r.rows || []).map((row) => ({
      candidateId: Number(row.id),
      fullName: row.fullName,
      email: row.email,
      jobRoleName: row.jobRoleName || null,
      orgUnitId: row.orgUnitId != null ? Number(row.orgUnitId) : null,
      orgUnitPath: pathOf(row.orgUnitId),
      flaggedCount: flagged.get(Number(row.id)) || 0,
      ...timeClockFields(row),
    })),
  };
}

function timeClockFields(row) {
  const e = resolveTimeClockEligibility({ workFormat: row.workFormat, override: row.timeClockOverride });
  return { workFormat: row.workFormat || null, timeClockEnabled: e.enabled, timeClockReason: e.reason };
}

function mapMirrorPunch(row) {
  return {
    id: Number(row.id),
    punchedAt: row.punchedAt,
    punchKind: row.punchKind,
    source: row.source,
    notes: row.notes || '',
    flag: row.flag || null,
    reviewStatus: row.reviewStatus,
    reviewedAt: row.reviewedAt || null,
    reviewedByName: row.reviewedByName || null,
    createdAt: row.createdAt,
    createdByName: row.createdByName || null,
    voidedAt: row.voidedAt || null,
    voidedByName: row.voidedByName || null,
    voidReason: row.voidReason || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
  };
}

/**
 * Per-person mirror for [from, to] (≤ TIME_MIRROR_MAX_DAYS, clamped to today).
 * Fixed number of queries regardless of period length (no per-day round trips).
 */
export async function getEmployeeTimeMirror(dbOrQuery, { companyId, candidateId, from, to }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const schedRes = await getCompanyTimeSchedule(db, { companyId: cid });
  if (!schedRes.ok) return schedRes;
  const schedule = schedRes.schedule;
  const tz = schedule.timezone || DEFAULT_SCHEDULE.timezone;
  const today = isoDayInTz(new Date(), tz);
  let toIso = parseIsoDay(to) || today;
  if (toIso > today) toIso = today;
  let fromIso = parseIsoDay(from) || addDaysIso(toIso, -29);
  if (fromIso > toIso) return fail(ERR.INVALID_DATE);
  if (daySpan(fromIso, toIso) > TIME_MIRROR_MAX_DAYS - 1) {
    fromIso = addDaysIso(toIso, -(TIME_MIRROR_MAX_DAYS - 1));
  }

  const emp = await db.query(
    `SELECT c.id, c.full_name AS "fullName", c.email, c.org_unit_id AS "orgUnitId",
            COALESCE(c.start_date, c.hired_at::date) AS "startDate",
            c.work_format AS "workFormat", c.time_clock_override AS "timeClockOverride",
            jr.name AS "jobRoleName"
     FROM candidates c
     LEFT JOIN job_roles jr ON jr.id = c.job_role_id AND jr.company_id = c.company_id
     WHERE c.id = $1 AND c.company_id = $2 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (emp.rowCount === 0) return fail(ERR.NOT_FOUND);
  const person = emp.rows[0];
  const eligibility = resolveTimeClockEligibility({
    workFormat: person.workFormat,
    override: person.timeClockOverride,
  });
  const startDate = person.startDate instanceof Date
    ? person.startDate.toISOString().slice(0, 10)
    : person.startDate ? String(person.startDate).slice(0, 10) : null;

  const startedOn = hourBankStartedOn(schedule, today);
  const cap = Number.isFinite(Number(schedule.hourBankMaxMinutes)) ? Number(schedule.hourBankMaxMinutes) : null;
  const [punchRes, justRes, bankBefore, bankDaysRes, locks, pathOf, requestsByDay, dayInfo, anchors] = await Promise.all([
    db.query(
      `SELECT p.id, p.punched_at AS "punchedAt", p.punch_kind AS "punchKind", p.source,
              p.notes, p.flag, p.review_status AS "reviewStatus", p.reviewed_at AS "reviewedAt",
              p.created_at AS "createdAt", p.voided_at AS "voidedAt", p.void_reason AS "voidReason",
              p.latitude, p.longitude,
              COALESCE(cu.display_name, cu.email) AS "createdByName",
              COALESCE(vu.display_name, vu.email) AS "voidedByName",
              COALESCE(ru.display_name, ru.email) AS "reviewedByName"
       FROM employee_time_punches p
       LEFT JOIN users cu ON cu.id = p.created_by_user_id
       LEFT JOIN users vu ON vu.id = p.voided_by_user_id
       LEFT JOIN users ru ON ru.id = p.reviewed_by_user_id
       WHERE p.company_id = $1 AND p.candidate_id = $2
         AND p.punched_at >= ($3::timestamp AT TIME ZONE $5)
         AND p.punched_at < (($4::timestamp + INTERVAL '1 day') AT TIME ZONE $5)
       ORDER BY p.punched_at ASC, p.id ASC
       LIMIT ${TIME_MIRROR_PUNCH_CAP}`,
      [cid, cand, fromIso, toIso, tz]
    ),
    db.query(
      `SELECT j.id, to_char(j.work_on, 'YYYY-MM-DD') AS "day", j.reason, j.note,
              to_char(j.excused_start, 'HH24:MI') AS "excusedStart",
              to_char(j.excused_end, 'HH24:MI') AS "excusedEnd",
              j.source_request_id AS "sourceRequestId",
              j.created_at AS "createdAt", j.updated_at AS "updatedAt",
              COALESCE(u.display_name, u.email) AS "updatedByName"
       FROM employee_time_day_justifications j
       LEFT JOIN users u ON u.id = COALESCE(j.updated_by_user_id, j.created_by_user_id)
       WHERE j.company_id = $1 AND j.candidate_id = $2
         AND j.work_on BETWEEN $3::date AND $4::date
       LIMIT ${TIME_MIRROR_MAX_DAYS}`,
      [cid, cand, fromIso, toIso]
    ),
    computeHourBankBalances(db, { companyId: cid, candidateIds: [cand], upTo: addDaysIso(fromIso, -1), schedule }),
    db.query(
      `SELECT to_char(work_on, 'YYYY-MM-DD') AS "day",
              COALESCE(SUM(CASE WHEN status = '${HOUR_BANK_STATUS.APPROVED}' THEN
                (CASE WHEN entry_kind = '${HOUR_BANK_ENTRY_KIND.CREDIT}' THEN minutes ELSE -minutes END)
              ELSE 0 END), 0)::int AS delta,
              COALESCE(SUM(CASE WHEN status = '${HOUR_BANK_STATUS.APPROVED}' AND source <> '${HOUR_BANK_SOURCE.TIME_CLOCK}' THEN
                (CASE WHEN entry_kind = '${HOUR_BANK_ENTRY_KIND.CREDIT}' THEN minutes ELSE -minutes END)
              ELSE 0 END), 0)::int AS manual,
              COUNT(*) FILTER (WHERE status = '${HOUR_BANK_STATUS.PENDING}')::int AS pending
       FROM employee_hour_bank_entries
       WHERE company_id = $1 AND candidate_id = $2
         AND work_on BETWEEN $3::date AND $4::date
       GROUP BY work_on`,
      [cid, cand, fromIso, toIso]
    ),
    listClosureLocksForCandidate(db, { companyId: cid, candidateId: cand, from: fromIso, to: toIso }),
    loadOrgUnitPaths(db, cid),
    listTimeRequestsByDay(db, { companyId: cid, candidateId: cand, from: fromIso, to: toIso, timeZone: tz }),
    loadPersonCalendar(db, {
      companyId: cid,
      candidateId: cand,
      orgUnitId: person.orgUnitId,
      companySchedule: schedule,
      from: fromIso,
      to: toIso,
    }),
    loadSnapshotAnchors(db, { companyId: cid, candidateId: cand, from: fromIso, to: toIso }),
  ]);

  const punchesByDay = new Map();
  for (const row of punchRes.rows || []) {
    const p = mapMirrorPunch(row);
    const day = isoDayInTz(p.punchedAt, tz);
    if (!punchesByDay.has(day)) punchesByDay.set(day, []);
    punchesByDay.get(day).push(p);
  }
  const justByDay = new Map(
    (justRes.rows || []).map((j) => [j.day, {
      id: Number(j.id),
      reason: j.reason,
      note: j.note || '',
      excusedStart: j.excusedStart || null,
      excusedEnd: j.excusedEnd || null,
      sourceRequestId: j.sourceRequestId != null ? Number(j.sourceRequestId) : null,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      updatedByName: j.updatedByName || null,
    }])
  );
  const bankByDay = new Map(
    (bankDaysRes.rows || []).map((b) => [b.day, {
      delta: Number(b.delta) || 0,
      manual: Number(b.manual) || 0,
      pending: Number(b.pending) || 0,
    }])
  );

  let balance = bankBefore.get(cand)?.balanceMinutes || 0;
  const totals = {
    workedMinutes: 0,
    expectedMinutes: 0,
    extraMinutes: 0,
    missingMinutes: 0,
    absences: 0,
    incomplete: 0,
    review: 0,
    justified: 0,
    holidays: 0,
    pendingRequests: 0,
  };
  const days = [];
  for (let iso = fromIso; iso <= toIso; iso = addDaysIso(iso, 1)) {
    const punches = punchesByDay.get(iso) || [];
    const justification = justByDay.get(iso) || null;
    const info = dayInfo(iso);
    const summary = summarizeTimeDay({
      punches,
      schedule: info.schedule,
      justification,
      // Without time clock: no expected hours, so no absence/missing alerts (history still shown).
      isWorkday: eligibility.enabled && info.isWorkday,
      isToday: iso === today,
      beforeStart: Boolean(startDate && iso < startDate),
      holiday: info.holiday,
    });
    const bank = bankByDay.get(iso) || { delta: 0, manual: 0, pending: 0 };
    if (iso < startedOn) balance += bank.delta;
    else {
      balance = stepHourBank(balance, { net: hourBankDayNet(summary, eligibility.enabled), manual: bank.manual, cap }).balance;
    }
    if (anchors.has(iso)) balance = anchors.get(iso);
    if (info.holiday) totals.holidays += 1;
    totals.workedMinutes += summary.workedMinutes;
    totals.expectedMinutes += summary.expectedMinutes;
    totals.extraMinutes += summary.extraMinutes;
    totals.missingMinutes += summary.missingMinutes;
    if (summary.occurrence === TIME_DAY_OCCURRENCE.ABSENCE) totals.absences += 1;
    if (summary.occurrence === TIME_DAY_OCCURRENCE.INCOMPLETE) totals.incomplete += 1;
    if (summary.occurrence === TIME_DAY_OCCURRENCE.REVIEW) totals.review += 1;
    if (summary.occurrence === TIME_DAY_OCCURRENCE.JUSTIFIED) totals.justified += 1;
    totals.pendingRequests += (requestsByDay.get(iso) || [])
      .filter((r) => r.status === TIME_REQUEST_STATUS.PENDING).length;
    days.push({
      day: iso,
      isWorkday: info.isWorkday,
      holiday: info.holiday,
      daySchedule: {
        workdayStart: info.schedule.workdayStart,
        workdayEnd: info.schedule.workdayEnd,
        breakStart: info.schedule.breakStart,
        breakEnd: info.schedule.breakEnd,
        breakMinutes: info.schedule.breakMinutes,
        source: info.schedule.source,
      },
      isToday: iso === today,
      punches,
      justification,
      ...summary,
      bankBalanceMinutes: balance,
      bankPendingCount: bank.pending,
      locked: isDayInLocks(iso, locks),
      requests: requestsByDay.get(iso) || [],
    });
  }

  return {
    ok: true,
    from: fromIso,
    to: toIso,
    today,
    maxDays: TIME_MIRROR_MAX_DAYS,
    schedule,
    hourBankStartedOn: startedOn,
    person: {
      candidateId: cand,
      fullName: person.fullName,
      email: person.email,
      jobRoleName: person.jobRoleName || null,
      orgUnitPath: pathOf(person.orgUnitId),
      startDate,
      workFormat: person.workFormat || null,
      timeClockEnabled: eligibility.enabled,
      timeClockReason: eligibility.reason,
    },
    totals: { ...totals, bankBalanceMinutes: balance },
    days,
    truncated: (punchRes.rows || []).length >= TIME_MIRROR_PUNCH_CAP,
  };
}

async function lockEmployee(db, companyId, candidateId) {
  const r = await db.query(
    `SELECT id FROM candidates
     WHERE id = $1 AND company_id = $2 AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     FOR UPDATE`,
    [candidateId, companyId]
  );
  return r.rowCount > 0;
}

function parseHm(raw) {
  const s = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * Validate an adjustment payload (manager action or collaborator request).
 * @returns {{ ok: true, voids: number[], adds: {time: string, kind: string}[], why: string } | { ok: false, errorCode: string }}
 */
export function normalizeTimeAdjustment({ voidPunchIds = [], add = [], reason }) {
  const why = clip(reason);
  if (why.length < 3) return fail(ERR.INVALID_DATA);
  const voids = [...new Set((voidPunchIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const adds = (add || []).map((a) => ({ time: parseHm(a?.time), kind: String(a?.kind || '').toLowerCase() }));
  if (adds.some((a) => !a.time || !TIME_PUNCH_KINDS.includes(a.kind))) return fail(ERR.INVALID_DATA);
  if (voids.length === 0 && adds.length === 0) return fail(ERR.INVALID_DATA);
  if (voids.length > TIME_ADJUST_MAX_VOID || adds.length > TIME_ADJUST_MAX_ADD) return fail(ERR.INVALID_DATA);
  return { ok: true, voids, adds, why };
}

/** Pure validation of the excuse part of a request. */
export function normalizeTimeExcuse({ excuseReason, excuseStart, excuseEnd }) {
  if (!TIME_REQUEST_EXCUSE_REASONS.includes(excuseReason)) return fail(ERR.INVALID_DATA);
  const hasStart = Boolean(String(excuseStart || '').trim());
  const hasEnd = Boolean(String(excuseEnd || '').trim());
  if (!hasStart && !hasEnd) return { ok: true, reason: excuseReason, start: null, end: null };
  const start = parseHm(excuseStart);
  const end = parseHm(excuseEnd);
  if (!start || !end || end <= start) return fail(ERR.INVALID_DATA);
  return { ok: true, reason: excuseReason, start, end };
}

/** Fails the surrounding transaction with an app error code (caught by the caller). */
function abort(code, message = code) {
  const err = new Error(message);
  err.appCode = code;
  throw err;
}

/**
 * Lock the employee and check the day is open. Call first inside a transaction.
 * @returns {Promise<{ ok: true, tz: string, today: string } | { ok: false, errorCode: string }>}
 */
export async function openTimeDayForWrite(client, { companyId, candidateId, day }) {
  if (!(await lockEmployee(client, companyId, candidateId))) return fail(ERR.NOT_FOUND);
  const open = await assertTimeDayOpen(client, { companyId, candidateId, day });
  if (!open.ok) return open;
  const schedRes = await getCompanyTimeSchedule(client, { companyId });
  const tz = schedRes.schedule?.timezone || DEFAULT_SCHEDULE.timezone;
  return { ok: true, tz, today: isoDayInTz(new Date(), tz) };
}

/**
 * Void + insert inside an open transaction (after openTimeDayForWrite). Throws with
 * err.appCode on stale punch ids or future times so the transaction rolls back.
 */
export async function applyTimeDayAdjustment(client, {
  companyId,
  candidateId,
  dayIso,
  tz,
  voids,
  adds,
  why,
  userId = null,
  staleCode = ERR.NOT_FOUND,
}) {
  const cid = companyId;
  const cand = candidateId;
  let voided = 0;
  if (voids.length) {
    const v = await client.query(
      `UPDATE employee_time_punches
       SET voided_at = NOW(), voided_by_user_id = $4, void_reason = $5,
           review_status = '${TIME_PUNCH_REVIEW.ADJUSTED}',
           reviewed_at = NOW(), reviewed_by_user_id = $4
       WHERE company_id = $1 AND candidate_id = $2 AND id = ANY($3::bigint[])
         AND voided_at IS NULL
         AND punched_at >= ($6::timestamp AT TIME ZONE $7)
         AND punched_at < (($6::timestamp + INTERVAL '1 day') AT TIME ZONE $7)
       RETURNING id`,
      [cid, cand, voids, userId, why, dayIso, tz]
    );
    if (v.rowCount !== voids.length) abort(staleCode, 'void mismatch');
    voided = v.rowCount;
  }

  const inserted = [];
  const ordered = [...adds].sort((a, b) => a.time.localeCompare(b.time));
  for (const a of ordered) {
    const ts = await client.query(
      `SELECT (($1::date + $2::time) AT TIME ZONE $3) AS at`,
      [dayIso, a.time, tz]
    );
    const at = ts.rows[0].at;
    if (new Date(at).getTime() > Date.now()) abort(ERR.INVALID_DATA, 'future punch');
    const res = await createTimePunch(client, {
      companyId: cid,
      candidateId: cand,
      punchKind: a.kind,
      source: TIME_PUNCH_SOURCE.MANAGER,
      punchedAt: new Date(at).toISOString(),
      notes: why,
      createdByUserId: userId,
    });
    if (!res.ok) abort(res.errorCode, 'insert');
    inserted.push(res.punch.id);
  }
  return { ok: true, day: dayIso, voided, insertedIds: inserted };
}

/** Maps err.appCode thrown inside a transaction back to a result object. */
export function appErrorResult(e) {
  if (e?.appCode) return fail(e.appCode);
  throw e;
}

/**
 * Adjust a day: void selected punches (kept for history) and insert corrected ones.
 * One transaction; the employee row lock serializes concurrent adjustments.
 */
export async function adjustTimeDay({
  companyId,
  candidateId,
  day,
  voidPunchIds = [],
  add = [],
  reason,
  userId = null,
}) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const dayIso = parseIsoDay(day);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0) || !dayIso) return fail(ERR.INVALID_DATA);
  const norm = normalizeTimeAdjustment({ voidPunchIds, add, reason });
  if (!norm.ok) return norm;

  return withTransaction(async (client) => {
    const open = await openTimeDayForWrite(client, { companyId: cid, candidateId: cand, day: dayIso });
    if (!open.ok) return open;
    return applyTimeDayAdjustment(client, {
      companyId: cid,
      candidateId: cand,
      dayIso,
      tz: open.tz,
      voids: norm.voids,
      adds: norm.adds,
      why: norm.why,
      userId,
    });
  }).catch(appErrorResult);
}

/**
 * Upsert the day's justification inside an open transaction. excusedStart/excusedEnd
 * (HH:mm) limit it to an interval; both null = whole day.
 */
export async function applyTimeDayJustification(client, {
  companyId,
  candidateId,
  dayIso,
  reason,
  note = '',
  excusedStart = null,
  excusedEnd = null,
  sourceRequestId = null,
  userId = null,
}) {
  const r = await client.query(
    `INSERT INTO employee_time_day_justifications
       (company_id, candidate_id, work_on, reason, note, excused_start, excused_end,
        source_request_id, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3::date, $4, $5, $6::time, $7::time, $8, $9, $9)
     ON CONFLICT (company_id, candidate_id, work_on) DO UPDATE SET
       reason = EXCLUDED.reason, note = EXCLUDED.note,
       excused_start = EXCLUDED.excused_start, excused_end = EXCLUDED.excused_end,
       source_request_id = EXCLUDED.source_request_id,
       updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
     RETURNING id`,
    [companyId, candidateId, dayIso, reason, clip(note), excusedStart, excusedEnd, sourceRequestId, userId]
  );
  return { ok: true, id: Number(r.rows[0].id), day: dayIso };
}

export async function upsertTimeDayJustification({ companyId, candidateId, day, reason, note = '', userId = null }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const dayIso = parseIsoDay(day);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0) || !dayIso) return fail(ERR.INVALID_DATA);
  if (!TIME_DAY_JUSTIFICATIONS.includes(reason)) return fail(ERR.INVALID_DATA);
  return withTransaction(async (client) => {
    const open = await openTimeDayForWrite(client, { companyId: cid, candidateId: cand, day: dayIso });
    if (!open.ok) return open;
    if (dayIso > open.today) return fail(ERR.INVALID_DATE);
    return applyTimeDayJustification(client, { companyId: cid, candidateId: cand, dayIso, reason, note, userId });
  });
}

export async function deleteTimeDayJustification({ companyId, candidateId, day }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const dayIso = parseIsoDay(day);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0) || !dayIso) return fail(ERR.INVALID_DATA);
  return withTransaction(async (client) => {
    if (!(await lockEmployee(client, cid, cand))) return fail(ERR.NOT_FOUND);
    const open = await assertTimeDayOpen(client, { companyId: cid, candidateId: cand, day: dayIso });
    if (!open.ok) return open;
    const r = await client.query(
      `DELETE FROM employee_time_day_justifications
       WHERE company_id = $1 AND candidate_id = $2 AND work_on = $3::date
       RETURNING id`,
      [cid, cand, dayIso]
    );
    if (r.rowCount === 0) return fail(ERR.NOT_FOUND);
    return { ok: true, id: Number(r.rows[0].id), day: dayIso };
  });
}

function mapClosure(row, pathOf) {
  return {
    id: Number(row.id),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    orgUnitId: row.orgUnitId != null ? Number(row.orgUnitId) : null,
    orgUnitPath: row.orgUnitId != null ? pathOf(row.orgUnitId) || row.orgUnitName || null : null,
    status: row.status,
    note: row.note || '',
    closedAt: row.closedAt,
    closedByName: row.closedByName || null,
    cancelledAt: row.cancelledAt || null,
    cancelledByName: row.cancelledByName || null,
    cancelReason: row.cancelReason || null,
  };
}

export async function listTimeClockClosures(dbOrQuery, {
  companyId,
  status = null,
  q = '',
  page = 1,
  pageSize = TIME_CLOCK_CLOSURES_PAGE_SIZE,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return fail(ERR.COMPANY_REQUIRED);
  const size = Math.min(50, Math.max(5, Number(pageSize) || TIME_CLOCK_CLOSURES_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid];
  let where = 'k.company_id = $1';
  if (status && TIME_CLOCK_CLOSURE_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND k.status = $${params.length}`;
  }
  const search = String(q || '').trim().slice(0, 80);
  if (/^\d{1,12}$/.test(search)) {
    params.push(Number(search));
    where += ` AND k.id = $${params.length}`;
  } else if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND LOWER(COALESCE(ou.name, '')) LIKE $${params.length}`;
  }
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS n FROM time_clock_closures k
     LEFT JOIN org_units ou ON ou.id = k.org_unit_id AND ou.company_id = k.company_id
     WHERE ${where}`,
    params
  );
  params.push(size, (pg - 1) * size);
  const r = await db.query(
    `SELECT k.id, to_char(k.period_start, 'YYYY-MM-DD') AS "periodStart",
            to_char(k.period_end, 'YYYY-MM-DD') AS "periodEnd",
            k.org_unit_id AS "orgUnitId", ou.name AS "orgUnitName",
            k.status, k.note, k.closed_at AS "closedAt", k.cancelled_at AS "cancelledAt",
            k.cancel_reason AS "cancelReason",
            COALESCE(cu.display_name, cu.email) AS "closedByName",
            COALESCE(xu.display_name, xu.email) AS "cancelledByName"
     FROM time_clock_closures k
     LEFT JOIN org_units ou ON ou.id = k.org_unit_id AND ou.company_id = k.company_id
     LEFT JOIN users cu ON cu.id = k.closed_by_user_id
     LEFT JOIN users xu ON xu.id = k.cancelled_by_user_id
     WHERE ${where}
     ORDER BY k.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const pathOf = await loadOrgUnitPaths(db, cid);
  return {
    ok: true,
    page: pg,
    pageSize: size,
    total: Number(countRes.rows[0]?.n) || 0,
    items: (r.rows || []).map((row) => mapClosure(row, pathOf)),
  };
}

/**
 * Close a past period (company-wide or one unit + descendants). Serialized per company;
 * rejects overlap with another concluded closure of the same scope or company-wide.
 */
export async function createTimeClockClosure({
  companyId,
  periodStart,
  periodEnd,
  orgUnitId = null,
  note = '',
  userId = null,
}) {
  const cid = Number(companyId);
  const start = parseIsoDay(periodStart);
  const end = parseIsoDay(periodEnd);
  const unit = orgUnitId != null && orgUnitId !== '' ? Number(orgUnitId) : null;
  if (!Number.isFinite(cid) || cid <= 0) return fail(ERR.COMPANY_REQUIRED);
  if (!start || !end || end < start || daySpan(start, end) > 92) return fail(ERR.INVALID_DATE);
  if (unit != null && (!Number.isFinite(unit) || unit <= 0)) return fail(ERR.INVALID_DATA);

  return withTransaction(async (client) => {
    const company = await client.query(
      'SELECT id FROM companies WHERE id = $1 AND deleted = FALSE FOR UPDATE',
      [cid]
    );
    if (!company.rowCount) return fail(ERR.NOT_FOUND);
    const schedRes = await getCompanyTimeSchedule(client, { companyId: cid });
    if (end >= isoDayInTz(new Date(), schedRes.schedule?.timezone)) return fail(ERR.TIME_CLOCK_CLOSURE_FUTURE);
    if (unit != null) {
      const u = await client.query(
        'SELECT id FROM org_units WHERE id = $1 AND company_id = $2 AND active = TRUE',
        [unit, cid]
      );
      if (!u.rowCount) return fail(ERR.NOT_FOUND);
    }
    const overlap = await client.query(
      `WITH RECURSIVE anc AS (
         SELECT id, parent_id, 1 AS depth FROM org_units WHERE company_id = $1 AND id = $4::int
         UNION ALL
         SELECT p.id, p.parent_id, anc.depth + 1
         FROM org_units p JOIN anc ON p.id = anc.parent_id
         WHERE p.company_id = $1 AND anc.depth < 20
       ), sub AS (
         SELECT id, 1 AS depth FROM org_units WHERE company_id = $1 AND id = $4::int
         UNION ALL
         SELECT u.id, sub.depth + 1
         FROM org_units u JOIN sub ON u.parent_id = sub.id
         WHERE u.company_id = $1 AND sub.depth < 20
       )
       SELECT id FROM time_clock_closures
       WHERE company_id = $1 AND status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
         AND period_start <= $3::date AND period_end >= $2::date
         AND (org_unit_id IS NULL OR $4::int IS NULL
              OR org_unit_id IN (SELECT id FROM anc) OR org_unit_id IN (SELECT id FROM sub))
       LIMIT 1`,
      [cid, start, end, unit]
    );
    if (overlap.rowCount) return fail(ERR.TIME_CLOCK_CLOSURE_OVERLAP);

    const tz = schedRes.schedule?.timezone || DEFAULT_SCHEDULE.timezone;
    const pending = await client.query(
      `WITH RECURSIVE scope AS (
         SELECT id, 1 AS depth FROM org_units WHERE company_id = $1 AND id = $5::int
         UNION ALL
         SELECT u.id, scope.depth + 1
         FROM org_units u JOIN scope ON u.parent_id = scope.id
         WHERE u.company_id = $1 AND scope.depth < 20
       )
       SELECT COUNT(*)::int AS n
       FROM employee_time_punches p
       JOIN candidates c ON c.id = p.candidate_id AND c.company_id = p.company_id
       WHERE p.company_id = $1
         AND p.review_status = '${TIME_PUNCH_REVIEW.FLAGGED}'
         AND p.voided_at IS NULL
         AND p.punched_at >= ($2::timestamp AT TIME ZONE $4)
         AND p.punched_at < (($3::timestamp + INTERVAL '1 day') AT TIME ZONE $4)
         AND ($5::int IS NULL OR c.org_unit_id IN (SELECT id FROM scope))`,
      [cid, start, end, tz, unit]
    );
    const r = await client.query(
      `INSERT INTO time_clock_closures
         (company_id, period_start, period_end, org_unit_id, note, closed_by_user_id)
       VALUES ($1, $2::date, $3::date, $4, $5, $6)
       RETURNING id`,
      [cid, start, end, unit, clip(note), userId]
    );
    const id = Number(r.rows[0].id);
    const frozen = await snapshotHourBankForClosure(client, {
      companyId: cid,
      closureId: id,
      periodStart: start,
      periodEnd: end,
      orgUnitId: unit,
      schedule: schedRes.schedule,
    });
    return {
      ok: true,
      id,
      periodStart: start,
      periodEnd: end,
      orgUnitId: unit,
      pendingReviewCount: Number(pending.rows[0]?.n) || 0,
      frozenBalances: frozen.count,
    };
  });
}

export async function cancelTimeClockClosure({ companyId, closureId, reason, userId = null }) {
  const cid = Number(companyId);
  const kid = Number(closureId);
  const why = clip(reason);
  if (![cid, kid].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  if (why.length < 3) return fail(ERR.INVALID_DATA);
  const db = asDb(null);
  const r = await db.query(
    `UPDATE time_clock_closures
     SET status = '${TIME_CLOCK_CLOSURE_STATUS.CANCELLED}', cancelled_at = NOW(),
         cancelled_by_user_id = $3, cancel_reason = $4
     WHERE id = $2 AND company_id = $1 AND status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
     RETURNING id, to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
               to_char(period_end, 'YYYY-MM-DD') AS "periodEnd"`,
    [cid, kid, userId, why]
  );
  if (r.rowCount === 0) {
    const exists = await db.query(
      'SELECT 1 FROM time_clock_closures WHERE id = $2 AND company_id = $1',
      [cid, kid]
    );
    return fail(exists.rowCount ? ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE : ERR.NOT_FOUND);
  }
  return { ok: true, id: kid, periodStart: r.rows[0].periodStart, periodEnd: r.rows[0].periodEnd };
}
