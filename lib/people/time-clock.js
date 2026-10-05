/**
 * B-2721 — Digital time clock MVP (web punches + day mirror).
 * Not payroll, eSocial, facial, or WhatsApp punch.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { COMPANY_MODULE, companyHasModule, normalizeEnabledModules } from '../company-modules.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';
import { parsePunchCoordinates } from '../time-clock-format.js';
import {
  EMPLOYMENT_STATUS,
  TIME_CLOCK_CLOSURE_STATUS,
  TIME_PUNCH_FLAG,
  TIME_PUNCH_KIND,
  TIME_PUNCH_KINDS,
  TIME_PUNCH_REVIEW,
  TIME_PUNCH_REVIEWS,
  TIME_PUNCH_SOURCE,
  TIME_PUNCH_SOURCES,
} from '../domain-status.js';
import { resolveDaySchedule } from './time-day-summary.js';

export const TIME_CLOCK_LIST_CAP = 200;
export const TIME_CLOCK_DAY_CAP = 80;
export const DEFAULT_SCHEDULE = Object.freeze({
  workdayStart: '09:00',
  workdayEnd: '18:00',
  breakMinutes: 60,
  timezone: 'America/Sao_Paulo',
  lateGraceMinutes: 10,
  hourBankEnabled: false,
  hourBankMaxMinutes: 2400,
});

function clipNotes(s) {
  return String(s || '').trim().slice(0, 500);
}

function parseTimeHm(raw, fallback) {
  const s = String(raw || '').trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  return fallback;
}

function mapSchedule(row) {
  if (!row) {
    return { ...DEFAULT_SCHEDULE, companyId: null, hourBankStartedOn: null, updatedAt: null };
  }
  return {
    companyId: Number(row.companyId),
    workdayStart: String(row.workdayStart).slice(0, 5),
    workdayEnd: String(row.workdayEnd).slice(0, 5),
    breakMinutes: Number(row.breakMinutes) || 0,
    timezone: row.timezone || DEFAULT_SCHEDULE.timezone,
    lateGraceMinutes: Number(row.lateGraceMinutes) || 0,
    hourBankEnabled: Boolean(row.hourBankEnabled),
    hourBankMaxMinutes:
      row.hourBankMaxMinutes != null
        ? Number(row.hourBankMaxMinutes)
        : DEFAULT_SCHEDULE.hourBankMaxMinutes,
    hourBankStartedOn: row.hourBankStartedOn || null,
    updatedAt: row.updatedAt || null,
  };
}

function mapPunch(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    candidateId: Number(row.candidateId),
    punchedAt: row.punchedAt,
    punchKind: row.punchKind,
    source: row.source,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    notes: row.notes || '',
    flag: row.flag || null,
    reviewStatus: row.reviewStatus || TIME_PUNCH_REVIEW.NONE,
    reviewedAt: row.reviewedAt || null,
    reviewedByUserId:
      row.reviewedByUserId != null ? Number(row.reviewedByUserId) : null,
    createdAt: row.createdAt,
    candidateName: row.candidateName || null,
    candidateEmail: row.candidateEmail || null,
  };
}

/**
 * Local HH:mm in schedule timezone (best-effort; falls back to UTC offset via Intl).
 */
export function localHmInTz(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || DEFAULT_SCHEDULE.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date instanceof Date ? date : new Date(date));
    const h = parts.find((p) => p.type === 'hour')?.value || '00';
    const m = parts.find((p) => p.type === 'minute')?.value || '00';
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    const d = date instanceof Date ? date : new Date(date);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}

function hmToMinutes(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Suggest flag for a new punch vs company schedule + prior punches today.
 */
export function suggestPunchFlag({ punchKind, punchedAt, schedule, todayPunches = [] }) {
  const kind = String(punchKind || '').toLowerCase();
  const sched = schedule || DEFAULT_SCHEDULE;
  const hm = localHmInTz(punchedAt, sched.timezone);
  const mins = hmToMinutes(hm);
  const start = hmToMinutes(sched.workdayStart);
  const end = hmToMinutes(sched.workdayEnd);
  const grace = Number(sched.lateGraceMinutes) || 0;

  const ordered = [...todayPunches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  const last = ordered[ordered.length - 1];
  if (last && last.punchKind === kind) {
    return TIME_PUNCH_FLAG.ODD_PAIR;
  }
  if (kind === TIME_PUNCH_KIND.IN && !last && mins > start + grace) {
    return TIME_PUNCH_FLAG.LATE;
  }
  if (kind === TIME_PUNCH_KIND.OUT && mins + 1 < end - grace) {
    return TIME_PUNCH_FLAG.EARLY_OUT;
  }
  if (kind === TIME_PUNCH_KIND.OUT && (!last || last.punchKind !== TIME_PUNCH_KIND.IN)) {
    return TIME_PUNCH_FLAG.ODD_PAIR;
  }
  if (kind === TIME_PUNCH_KIND.IN && last && last.punchKind !== TIME_PUNCH_KIND.OUT) {
    return TIME_PUNCH_FLAG.ODD_PAIR;
  }
  return null;
}

export async function getCompanyTimeSchedule(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  const r = await db.query(
    `SELECT company_id AS "companyId",
            to_char(workday_start, 'HH24:MI') AS "workdayStart",
            to_char(workday_end, 'HH24:MI') AS "workdayEnd",
            break_minutes AS "breakMinutes",
            timezone,
            late_grace_minutes AS "lateGraceMinutes",
            hour_bank_enabled AS "hourBankEnabled",
            hour_bank_max_minutes AS "hourBankMaxMinutes",
            to_char(hour_bank_started_on, 'YYYY-MM-DD') AS "hourBankStartedOn",
            updated_at AS "updatedAt"
     FROM company_time_schedules
     WHERE company_id = $1
     LIMIT 1`,
    [cid]
  );
  return { ok: true, schedule: mapSchedule(r.rows[0] || null) };
}

export async function upsertCompanyTimeSchedule(dbOrQuery, {
  companyId,
  workdayStart,
  workdayEnd,
  breakMinutes,
  timezone,
  lateGraceMinutes,
  hourBankEnabled,
  hourBankMaxMinutes,
  updatedByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  const existing = await getCompanyTimeSchedule(db, { companyId: cid });
  const prev = existing.schedule || DEFAULT_SCHEDULE;
  const start = parseTimeHm(
    workdayStart !== undefined ? workdayStart : prev.workdayStart,
    DEFAULT_SCHEDULE.workdayStart
  );
  const end = parseTimeHm(
    workdayEnd !== undefined ? workdayEnd : prev.workdayEnd,
    DEFAULT_SCHEDULE.workdayEnd
  );
  if (hmToMinutes(end) <= hmToMinutes(start)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const brk = Math.min(
    240,
    Math.max(
      0,
      Number(breakMinutes !== undefined ? breakMinutes : prev.breakMinutes) || 0
    )
  );
  const grace = Math.min(
    120,
    Math.max(
      0,
      Number(lateGraceMinutes !== undefined ? lateGraceMinutes : prev.lateGraceMinutes) || 0
    )
  );
  const tz =
    String(
      timezone !== undefined ? timezone : prev.timezone || DEFAULT_SCHEDULE.timezone
    )
      .trim()
      .slice(0, 64) || DEFAULT_SCHEDULE.timezone;

  const bankOn =
    hourBankEnabled === undefined
      ? Boolean(prev.hourBankEnabled)
      : Boolean(hourBankEnabled);
  let bankMax = Number(
    hourBankMaxMinutes === undefined ? prev.hourBankMaxMinutes : hourBankMaxMinutes
  );
  if (!Number.isFinite(bankMax)) bankMax = DEFAULT_SCHEDULE.hourBankMaxMinutes;
  bankMax = Math.min(20000, Math.max(0, Math.floor(bankMax)));

  const r = await db.query(
    `INSERT INTO company_time_schedules (
       company_id, workday_start, workday_end, break_minutes, timezone,
       late_grace_minutes, hour_bank_enabled, hour_bank_max_minutes,
       hour_bank_started_on, updated_at, updated_by_user_id
     ) VALUES ($1, $2::time, $3::time, $4, $5, $6, $7, $8, $10::date, NOW(), $9)
     ON CONFLICT (company_id) DO UPDATE SET
       workday_start = EXCLUDED.workday_start,
       workday_end = EXCLUDED.workday_end,
       break_minutes = EXCLUDED.break_minutes,
       timezone = EXCLUDED.timezone,
       late_grace_minutes = EXCLUDED.late_grace_minutes,
       hour_bank_enabled = EXCLUDED.hour_bank_enabled,
       hour_bank_max_minutes = EXCLUDED.hour_bank_max_minutes,
       hour_bank_started_on = CASE
         WHEN NOT company_time_schedules.hour_bank_enabled AND EXCLUDED.hour_bank_enabled
           THEN EXCLUDED.hour_bank_started_on
         ELSE company_time_schedules.hour_bank_started_on
       END,
       updated_at = NOW(),
       updated_by_user_id = EXCLUDED.updated_by_user_id
     RETURNING company_id AS "companyId",
               to_char(workday_start, 'HH24:MI') AS "workdayStart",
               to_char(workday_end, 'HH24:MI') AS "workdayEnd",
               break_minutes AS "breakMinutes",
               timezone,
               late_grace_minutes AS "lateGraceMinutes",
               hour_bank_enabled AS "hourBankEnabled",
               hour_bank_max_minutes AS "hourBankMaxMinutes",
               to_char(hour_bank_started_on, 'YYYY-MM-DD') AS "hourBankStartedOn",
               updated_at AS "updatedAt"`,
    [cid, start, end, brk, tz, grace, bankOn, bankMax, updatedByUserId, isoDayInTz(new Date(), tz)]
  );
  return { ok: true, schedule: mapSchedule(r.rows[0]) };
}

async function listPunchesForCandidateDay(db, { companyId, candidateId, day, timeZone }) {
  const tz = timeZone || DEFAULT_SCHEDULE.timezone;
  const r = await db.query(
    `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
            punched_at AS "punchedAt", punch_kind AS "punchKind", source,
            latitude, longitude, notes, flag,
            review_status AS "reviewStatus",
            reviewed_at AS "reviewedAt",
            reviewed_by_user_id AS "reviewedByUserId",
            created_at AS "createdAt"
     FROM employee_time_punches
     WHERE company_id = $1 AND candidate_id = $2
       AND voided_at IS NULL
       AND punched_at >= ($3::timestamp AT TIME ZONE $4)
       AND punched_at < (($3::timestamp AT TIME ZONE $4) + INTERVAL '1 day')
     ORDER BY punched_at ASC, id ASC
     LIMIT 40`,
    [companyId, candidateId, day, tz]
  );
  return (r.rows || []).map(mapPunch);
}

export function isoDayInTz(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || DEFAULT_SCHEDULE.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date instanceof Date ? date : new Date(date));
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Concluded closures covering a person in [from, to]: company-wide or on the person's
 * unit / any ancestor unit. Bounded by the closure index + unit depth.
 */
export async function listClosureLocksForCandidate(dbOrQuery, { companyId, candidateId, from, to }) {
  const db = asDb(dbOrQuery);
  const r = await db.query(
    `WITH RECURSIVE anc AS (
       SELECT u.id, u.parent_id, 1 AS depth
       FROM candidates c
       JOIN org_units u ON u.id = c.org_unit_id AND u.company_id = c.company_id
       WHERE c.company_id = $1 AND c.id = $2
       UNION ALL
       SELECT p.id, p.parent_id, anc.depth + 1
       FROM org_units p
       JOIN anc ON p.id = anc.parent_id
       WHERE p.company_id = $1 AND anc.depth < 20
     )
     SELECT id,
            to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
            to_char(period_end, 'YYYY-MM-DD') AS "periodEnd"
     FROM time_clock_closures
     WHERE company_id = $1
       AND status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
       AND period_start <= $4::date
       AND period_end >= $3::date
       AND (org_unit_id IS NULL OR org_unit_id IN (SELECT id FROM anc))
     ORDER BY period_start ASC
     LIMIT 50`,
    [companyId, candidateId, from, to]
  );
  return (r.rows || []).map((row) => ({
    id: Number(row.id),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  }));
}

export function isDayInLocks(day, locks = []) {
  return locks.some((l) => l.periodStart <= day && day <= l.periodEnd);
}

export async function assertTimeDayOpen(dbOrQuery, { companyId, candidateId, day }) {
  const locks = await listClosureLocksForCandidate(dbOrQuery, {
    companyId,
    candidateId,
    from: day,
    to: day,
  });
  if (locks.length > 0) return { ok: false, errorCode: ERR.TIME_CLOCK_PERIOD_CLOSED };
  return { ok: true };
}

/**
 * Company DP module + per-collaborator eligibility (migration 140) in one row.
 * @returns {Promise<{ ok: boolean, errorCode?: string, enabled?: boolean, reason?: string, moduleEnabled?: boolean }>}
 */
export async function getTimeClockAccess(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const res = await db.query(
    `SELECT c.work_format AS "workFormat", c.time_clock_override AS "override",
            co.enabled_modules AS "enabledModules"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id
     WHERE c.id = $1 AND c.company_id = $2 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = res.rows[0];
  const moduleEnabled = companyHasModule(normalizeEnabledModules(row.enabledModules), COMPANY_MODULE.DP);
  const person = resolveTimeClockEligibility({ workFormat: row.workFormat, override: row.override });
  return { ok: true, moduleEnabled, enabled: moduleEnabled && person.enabled, reason: person.reason };
}

/**
 * Company schedule merged with the person's schedule in force on `day` (migration 143):
 * own start/end/break and weekdays, company tolerance and timezone.
 */
export async function loadEffectiveDaySchedule(dbOrQuery, { companyId, candidateId, day, companySchedule }) {
  const db = asDb(dbOrQuery);
  const r = await db.query(
    `SELECT to_char(valid_from, 'YYYY-MM-DD') AS "validFrom", follows_company AS "followsCompany",
            to_char(workday_start, 'HH24:MI') AS "workdayStart", to_char(workday_end, 'HH24:MI') AS "workdayEnd",
            to_char(break_start, 'HH24:MI') AS "breakStart", to_char(break_end, 'HH24:MI') AS "breakEnd",
            weekdays
     FROM employee_time_schedules
     WHERE company_id = $1 AND candidate_id = $2 AND valid_from <= $3::date
     ORDER BY valid_from DESC
     LIMIT 1`,
    [companyId, candidateId, day]
  );
  const rows = (r.rows || []).map((row) => ({
    ...row,
    weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : null,
  }));
  return { ...companySchedule, ...resolveDaySchedule(companySchedule, rows, day) };
}

export async function getEmployeeTimeClockToday(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const access = await getTimeClockAccess(db, { companyId: cid, candidateId: cand });
  if (!access.ok) return access;
  if (!access.enabled) return { ok: false, errorCode: ERR.TIME_CLOCK_DISABLED };
  const schedRes = await getCompanyTimeSchedule(db, { companyId: cid });
  if (!schedRes.ok) return schedRes;
  const day = isoDayInTz(new Date(), schedRes.schedule.timezone);
  const [punches, schedule, lastLocated] = await Promise.all([
    listPunchesForCandidateDay(db, {
      companyId: cid,
      candidateId: cand,
      day,
      timeZone: schedRes.schedule.timezone,
    }),
    loadEffectiveDaySchedule(db, { companyId: cid, candidateId: cand, day, companySchedule: schedRes.schedule }),
    db.query(
      `SELECT latitude, longitude, punched_at AS "punchedAt", punch_kind AS "punchKind"
       FROM employee_time_punches
       WHERE candidate_id = $2 AND company_id = $1 AND voided_at IS NULL
         AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY punched_at DESC
       LIMIT 1`,
      [cid, cand]
    ),
  ]);
  const loc = lastLocated.rows[0] || null;
  const last = punches[punches.length - 1] || null;
  const nextKind =
    !last || last.punchKind === TIME_PUNCH_KIND.OUT
      ? TIME_PUNCH_KIND.IN
      : TIME_PUNCH_KIND.OUT;
  return {
    ok: true,
    day,
    schedule,
    punches,
    nextKind,
    open: Boolean(last && last.punchKind === TIME_PUNCH_KIND.IN),
    lastLocation: loc
      ? {
          latitude: Number(loc.latitude),
          longitude: Number(loc.longitude),
          punchedAt: loc.punchedAt,
          punchKind: loc.punchKind,
        }
      : null,
  };
}

export async function createTimePunch(dbOrQuery, {
  companyId,
  candidateId,
  punchKind,
  source = TIME_PUNCH_SOURCE.WEB,
  latitude = null,
  longitude = null,
  notes = '',
  punchedAt = null,
  createdByUserId = null,
  idempotencyKey = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const kind = String(punchKind || '').toLowerCase();
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  if (!TIME_PUNCH_KINDS.includes(kind)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const src = TIME_PUNCH_SOURCES.includes(source) ? source : TIME_PUNCH_SOURCE.WEB;

  const access = await getTimeClockAccess(db, { companyId: cid, candidateId: cand });
  if (!access.ok) return access;
  // Manager corrections of past days stay allowed (history of people who lost the time clock).
  if (!access.enabled && src !== TIME_PUNCH_SOURCE.MANAGER) {
    return { ok: false, errorCode: ERR.TIME_CLOCK_DISABLED };
  }

  const schedRes = await getCompanyTimeSchedule(db, { companyId: cid });
  const when = punchedAt ? new Date(punchedAt) : new Date();
  if (Number.isNaN(when.getTime())) return { ok: false, errorCode: ERR.INVALID_DATA };
  const day = isoDayInTz(when, schedRes.schedule.timezone);
  if (src === TIME_PUNCH_SOURCE.MANAGER) {
    const open = await assertTimeDayOpen(db, { companyId: cid, candidateId: cand, day });
    if (!open.ok) return open;
  }
  // Sequential: may run on a transaction client (manager adjustment / request approval).
  const todayPunches = await listPunchesForCandidateDay(db, {
    companyId: cid,
    candidateId: cand,
    day,
    timeZone: schedRes.schedule.timezone,
  });
  const daySchedule = await loadEffectiveDaySchedule(db, { companyId: cid, candidateId: cand, day, companySchedule: schedRes.schedule });

  let flag = suggestPunchFlag({
    punchKind: kind,
    punchedAt: when,
    schedule: daySchedule,
    todayPunches,
  });
  if (src === TIME_PUNCH_SOURCE.MANAGER) {
    flag = flag || TIME_PUNCH_FLAG.MANUAL;
  }

  const coords = parsePunchCoordinates(latitude, longitude);
  const lat = coords ? Math.round(coords.latitude * 1e6) / 1e6 : null;
  const lng = coords ? Math.round(coords.longitude * 1e6) / 1e6 : null;

  const reviewStatus =
    flag && flag !== TIME_PUNCH_FLAG.MANUAL
      ? TIME_PUNCH_REVIEW.FLAGGED
      : TIME_PUNCH_REVIEW.NONE;

  const r = await db.query(
    `INSERT INTO employee_time_punches (
       company_id, candidate_id, punched_at, punch_kind, source,
       latitude, longitude, notes, flag, review_status, idempotency_key,
       created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (company_id, candidate_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               punched_at AS "punchedAt", punch_kind AS "punchKind", source,
               latitude, longitude, notes, flag,
               review_status AS "reviewStatus",
               reviewed_at AS "reviewedAt",
               reviewed_by_user_id AS "reviewedByUserId",
               created_at AS "createdAt"`,
    [
      cid,
      cand,
      when.toISOString(),
      kind,
      src,
      lat,
      lng,
      clipNotes(notes),
      flag,
      reviewStatus,
      idempotencyKey,
      src === TIME_PUNCH_SOURCE.MANAGER ? createdByUserId ?? null : null,
    ]
  );
  return { ok: true, punch: mapPunch(r.rows[0]), day };
}

export async function listCompanyTimePunches(dbOrQuery, {
  companyId,
  day = null,
  reviewStatus = null,
  q = '',
  limit = TIME_CLOCK_DAY_CAP,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  const schedRes = await getCompanyTimeSchedule(db, { companyId: cid });
  const dayIso = day || isoDayInTz(new Date(), schedRes.schedule.timezone);
  const tz = schedRes.schedule.timezone || DEFAULT_SCHEDULE.timezone;
  const cap = Math.min(TIME_CLOCK_LIST_CAP, Math.max(1, Number(limit) || TIME_CLOCK_DAY_CAP));
  const params = [cid, dayIso, tz];
  let where = `p.company_id = $1
       AND p.voided_at IS NULL
       AND p.punched_at >= ($2::timestamp AT TIME ZONE $3)
       AND p.punched_at < (($2::timestamp AT TIME ZONE $3) + INTERVAL '1 day')`;
  if (reviewStatus && TIME_PUNCH_REVIEWS.includes(reviewStatus)) {
    params.push(reviewStatus);
    where += ` AND p.review_status = $${params.length}`;
  }
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(c.full_name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length})`;
  }
  params.push(cap);
  const r = await db.query(
    `SELECT p.id, p.company_id AS "companyId", p.candidate_id AS "candidateId",
            p.punched_at AS "punchedAt", p.punch_kind AS "punchKind", p.source,
            p.latitude, p.longitude, p.notes, p.flag,
            p.review_status AS "reviewStatus",
            p.reviewed_at AS "reviewedAt",
            p.reviewed_by_user_id AS "reviewedByUserId",
            p.created_at AS "createdAt",
            c.full_name AS "candidateName", c.email AS "candidateEmail"
     FROM employee_time_punches p
     JOIN candidates c ON c.id = p.candidate_id AND c.company_id = p.company_id
     WHERE ${where}
     ORDER BY p.punched_at ASC, p.id ASC
     LIMIT $${params.length}`,
    params
  );
  const items = (r.rows || []).map(mapPunch);
  const flagged = items.filter((p) => p.reviewStatus === TIME_PUNCH_REVIEW.FLAGGED).length;
  return {
    ok: true,
    day: dayIso,
    schedule: schedRes.schedule,
    items,
    flaggedCount: flagged,
    cap,
  };
}

export async function reviewTimePunch(dbOrQuery, {
  companyId,
  punchId,
  reviewStatus,
  reviewedByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const pid = Number(punchId);
  const status = String(reviewStatus || '').toLowerCase();
  if (![cid, pid].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  if (![TIME_PUNCH_REVIEW.OK, TIME_PUNCH_REVIEW.FLAGGED, TIME_PUNCH_REVIEW.ADJUSTED].includes(status)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const cur = await db.query(
    `SELECT p.candidate_id AS "candidateId", p.punched_at AS "punchedAt", s.timezone
     FROM employee_time_punches p
     LEFT JOIN company_time_schedules s ON s.company_id = p.company_id
     WHERE p.id = $2 AND p.company_id = $1
     LIMIT 1`,
    [cid, pid]
  );
  if (cur.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const open = await assertTimeDayOpen(db, {
    companyId: cid,
    candidateId: Number(cur.rows[0].candidateId),
    day: isoDayInTz(cur.rows[0].punchedAt, cur.rows[0].timezone || DEFAULT_SCHEDULE.timezone),
  });
  if (!open.ok) return open;
  const r = await db.query(
    `UPDATE employee_time_punches
     SET review_status = $3,
         reviewed_at = NOW(),
         reviewed_by_user_id = $4
     WHERE id = $2 AND company_id = $1
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               punched_at AS "punchedAt", punch_kind AS "punchKind", source,
               latitude, longitude, notes, flag,
               review_status AS "reviewStatus",
               reviewed_at AS "reviewedAt",
               reviewed_by_user_id AS "reviewedByUserId",
               created_at AS "createdAt"`,
    [cid, pid, status, reviewedByUserId]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, punch: mapPunch(r.rows[0]) };
}

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV rows for a day (cap).
 */
export async function exportTimePunchesCsv(dbOrQuery, { companyId, day = null }) {
  const listed = await listCompanyTimePunches(dbOrQuery, {
    companyId,
    day,
    limit: TIME_CLOCK_LIST_CAP,
  });
  if (!listed.ok) return listed;
  const header = [
    'id',
    'candidate_id',
    'name',
    'email',
    'punched_at',
    'kind',
    'source',
    'flag',
    'review_status',
    'latitude',
    'longitude',
    'notes',
  ];
  const lines = [header.join(',')];
  const esc = csvCell;
  for (const p of listed.items) {
    lines.push(
      [
        p.id,
        p.candidateId,
        p.candidateName,
        p.candidateEmail,
        p.punchedAt instanceof Date ? p.punchedAt.toISOString() : p.punchedAt,
        p.punchKind,
        p.source,
        p.flag || '',
        p.reviewStatus,
        p.latitude ?? '',
        p.longitude ?? '',
        p.notes,
      ]
        .map(esc)
        .join(',')
    );
  }
  return {
    ok: true,
    day: listed.day,
    csv: `${lines.join('\n')}\n`,
    count: listed.items.length,
  };
}
