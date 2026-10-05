/**
 * Ponto fase 2: jornada efetiva por dia (escala da empresa ou jornada própria vigente)
 * e feriados da empresa / unidade. Leituras em lote (por período e grupo de pessoas);
 * a resolução por dia é pura e em memória.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import {
  HOLIDAY_RECURRENCE,
  HOLIDAY_RECURRENCES,
  HOLIDAY_SOURCE,
  TIME_CLOCK_CLOSURE_STATUS,
  WEEKDAYS,
} from '../domain-status.js';
import { getCompanyTimeSchedule, listClosureLocksForCandidate } from './time-clock.js';
import { addDaysIso, companyDaySchedule, parseIsoDay, resolveDaySchedule } from './time-day-summary.js';
import { loadOrgUnitAncestors, loadOrgUnitPaths } from './org-units.js';

export const HOLIDAYS_PAGE_SIZE = 25;
export const HOLIDAYS_RANGE_CAP = 1000;
export const EMPLOYEE_SCHEDULES_CAP = 60;
const FAR_FUTURE = '9999-12-31';
const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

const fail = (errorCode) => ({ ok: false, errorCode });
const validId = (n) => Number.isFinite(n) && n > 0;

function parseHm(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Sorted unique weekdays 0–6, or null when empty / invalid. */
export function normalizeWeekdays(list) {
  if (!Array.isArray(list)) return null;
  const set = new Set();
  for (const v of list) {
    const n = Number(v);
    if (!Number.isInteger(n) || !WEEKDAYS.includes(n)) return null;
    set.add(n);
  }
  return set.size ? [...set].sort((a, b) => a - b) : null;
}

/** Pure validation of an employee schedule (mirrors the migration 143 CHECK). */
export function normalizeEmployeeSchedule({
  followsCompany = false,
  workdayStart,
  workdayEnd,
  breakStart,
  breakEnd,
  weekdays,
}) {
  if (followsCompany) {
    return { ok: true, value: { followsCompany: true, workdayStart: null, workdayEnd: null, breakStart: null, breakEnd: null, weekdays: null } };
  }
  const start = parseHm(workdayStart);
  const end = parseHm(workdayEnd);
  const days = normalizeWeekdays(weekdays);
  if (!start || !end || end <= start || !days) return fail(ERR.INVALID_DATA);
  const hasBreak = Boolean(String(breakStart || '').trim() || String(breakEnd || '').trim());
  let bStart = null;
  let bEnd = null;
  if (hasBreak) {
    bStart = parseHm(breakStart);
    bEnd = parseHm(breakEnd);
    if (!bStart || !bEnd || bEnd <= bStart || bStart < start || bEnd > end) return fail(ERR.INVALID_DATA);
  }
  return { ok: true, value: { followsCompany: false, workdayStart: start, workdayEnd: end, breakStart: bStart, breakEnd: bEnd, weekdays: days } };
}

export { companyDaySchedule, resolveDaySchedule };

/** Anonymous Gregorian algorithm. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Brazilian national holidays of a year (Lei 662/1949, 6.802/1980, 14.759/2023) + Good Friday. */
export function nationalHolidays(year) {
  const y = Number(year);
  const list = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['12-25', 'Natal'],
  ];
  if (y >= 2024) list.push(['11-20', 'Dia Nacional de Zumbi e da Consciência Negra']);
  const items = list.map(([md, name]) => ({ day: `${y}-${md}`, name }));
  items.push({ day: addDaysIso(easterSunday(y), -2), name: 'Sexta-feira Santa' });
  return items.sort((a, b) => a.day.localeCompare(b.day));
}

/** Concrete occurrences in [from, to]; yearly rows repeat from their first year on. */
export function expandHolidays(rows, from, to) {
  const out = [];
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  for (const row of rows || []) {
    if (row.recurrence !== HOLIDAY_RECURRENCE.YEARLY) {
      if (row.day >= from && row.day <= to) out.push({ ...row, occursOn: row.day });
      continue;
    }
    const md = row.day.slice(5);
    for (let y = Math.max(fromYear, Number(row.day.slice(0, 4))); y <= toYear; y += 1) {
      const occursOn = parseIsoDay(`${y}-${md}`);
      if (occursOn && occursOn >= from && occursOn <= to) out.push({ ...row, occursOn });
    }
  }
  return out;
}

/** day → holiday applying to a person in `unitChain` (own unit + ancestors). */
export function buildHolidayIndex(occurrences, unitChain = []) {
  const units = new Set((unitChain || []).map(Number));
  const index = new Map();
  for (const h of occurrences || []) {
    if (h.orgUnitId != null && !units.has(Number(h.orgUnitId))) continue;
    if (!index.has(h.occursOn)) index.set(h.occursOn, { id: h.id, name: h.name, orgUnitId: h.orgUnitId });
  }
  return index;
}

function mapScheduleRow(row) {
  return {
    id: Number(row.id),
    candidateId: Number(row.candidateId),
    validFrom: row.validFrom,
    followsCompany: Boolean(row.followsCompany),
    workdayStart: row.workdayStart || null,
    workdayEnd: row.workdayEnd || null,
    breakStart: row.breakStart || null,
    breakEnd: row.breakEnd || null,
    weekdays: Array.isArray(row.weekdays) ? row.weekdays.map(Number) : null,
    createdAt: row.createdAt,
    createdByName: row.createdByName || null,
  };
}

const SCHEDULE_COLUMNS = `s.id, s.candidate_id AS "candidateId",
  to_char(s.valid_from, 'YYYY-MM-DD') AS "validFrom", s.follows_company AS "followsCompany",
  to_char(s.workday_start, 'HH24:MI') AS "workdayStart", to_char(s.workday_end, 'HH24:MI') AS "workdayEnd",
  to_char(s.break_start, 'HH24:MI') AS "breakStart", to_char(s.break_end, 'HH24:MI') AS "breakEnd",
  s.weekdays, s.created_at AS "createdAt"`;

/** candidateId → schedule rows (valid_from <= upTo) ascending. One query per batch. */
export async function loadEmployeeSchedules(dbOrQuery, { companyId, candidateIds, upTo }) {
  const db = asDb(dbOrQuery);
  const ids = [...new Set((candidateIds || []).map(Number).filter(validId))];
  const byCandidate = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byCandidate;
  const r = await db.query(
    `SELECT ${SCHEDULE_COLUMNS}
     FROM employee_time_schedules s
     WHERE s.company_id = $1 AND s.candidate_id = ANY($2::bigint[]) AND s.valid_from <= $3::date
     ORDER BY s.candidate_id, s.valid_from ASC
     LIMIT ${EMPLOYEE_SCHEDULES_CAP * Math.max(1, ids.length)}`,
    [Number(companyId), ids, upTo || FAR_FUTURE]
  );
  for (const row of r.rows || []) byCandidate.get(Number(row.candidateId))?.push(mapScheduleRow(row));
  return byCandidate;
}

function mapHolidayRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    day: row.day,
    recurrence: row.recurrence,
    source: row.source,
    orgUnitId: row.orgUnitId != null ? Number(row.orgUnitId) : null,
  };
}

const HOLIDAY_COLUMNS = `h.id, h.name, to_char(h.holiday_on, 'YYYY-MM-DD') AS "day", h.recurrence, h.source,
  h.org_unit_id AS "orgUnitId"`;

/** Holiday rows that may occur in [from, to] (expand with `expandHolidays`). */
export async function loadHolidaysInRange(dbOrQuery, { companyId, from, to }) {
  const db = asDb(dbOrQuery);
  const r = await db.query(
    `SELECT ${HOLIDAY_COLUMNS}
     FROM company_holidays h
     WHERE h.company_id = $1
       AND ((h.recurrence = '${HOLIDAY_RECURRENCE.ONCE}' AND h.holiday_on BETWEEN $2::date AND $3::date)
         OR (h.recurrence = '${HOLIDAY_RECURRENCE.YEARLY}' AND h.holiday_on <= $3::date))
     ORDER BY h.holiday_on
     LIMIT ${HOLIDAYS_RANGE_CAP}`,
    [Number(companyId), from, to]
  );
  return (r.rows || []).map(mapHolidayRow);
}

/**
 * Per-person calendar for [from, to]: `dayInfo(iso)` → { schedule, isWorkday, holiday }.
 * Inputs come from the batch loaders so N people cost a fixed number of queries.
 */
export function buildPersonCalendar({ companySchedule, scheduleRows = [], holidayOccurrences = [], unitChain = [] }) {
  const holidays = buildHolidayIndex(holidayOccurrences, unitChain);
  return (iso) => {
    const schedule = resolveDaySchedule(companySchedule, scheduleRows, iso);
    const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
    return {
      schedule,
      isWorkday: schedule.weekdays.includes(weekday),
      holiday: holidays.get(iso) || null,
    };
  };
}

/** Calendar for one person in [from, to] (mirror, history, punch). */
export async function loadPersonCalendar(dbOrQuery, { companyId, candidateId, orgUnitId, companySchedule, from, to }) {
  const db = asDb(dbOrQuery);
  const [schedules, holidayRows, ancestorsOf] = await Promise.all([
    loadEmployeeSchedules(db, { companyId, candidateIds: [candidateId], upTo: to }),
    loadHolidaysInRange(db, { companyId, from, to }),
    loadOrgUnitAncestors(db, companyId),
  ]);
  return buildPersonCalendar({
    companySchedule,
    scheduleRows: schedules.get(Number(candidateId)) || [],
    holidayOccurrences: expandHolidays(holidayRows, from, to),
    unitChain: ancestorsOf(orgUnitId),
  });
}

// ── Jornada por colaborador ──────────────────────────────────────────────────

async function assertEmployeeRow(db, companyId, candidateId) {
  const r = await db.query(
    `SELECT id FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [candidateId, companyId]
  );
  return r.rowCount > 0;
}

async function assertOpenFrom(db, { companyId, candidateId, from }) {
  const locks = await listClosureLocksForCandidate(db, { companyId, candidateId, from, to: FAR_FUTURE });
  return locks.length ? fail(ERR.TIME_CLOCK_PERIOD_CLOSED) : { ok: true };
}

export async function listEmployeeScheduleHistory(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!validId(cid) || !validId(cand)) return fail(ERR.INVALID_ID);
  if (!(await assertEmployeeRow(db, cid, cand))) return fail(ERR.NOT_FOUND);
  const [rows, sched] = await Promise.all([
    db.query(
      `SELECT ${SCHEDULE_COLUMNS}, COALESCE(u.display_name, u.email) AS "createdByName"
       FROM employee_time_schedules s
       LEFT JOIN users u ON u.id = s.created_by_user_id
       WHERE s.company_id = $1 AND s.candidate_id = $2
       ORDER BY s.valid_from DESC
       LIMIT ${EMPLOYEE_SCHEDULES_CAP}`,
      [cid, cand]
    ),
    getCompanyTimeSchedule(db, { companyId: cid }),
  ]);
  return {
    ok: true,
    items: (rows.rows || []).map(mapScheduleRow),
    companySchedule: companyDaySchedule(sched.schedule),
  };
}

/** New schedule from `validFrom` on (same date replaces). Days already closed cannot change. */
export async function saveEmployeeSchedule(dbOrQuery, { companyId, candidateId, validFrom, userId = null, ...fields }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const from = parseIsoDay(validFrom);
  if (!validId(cid) || !validId(cand)) return fail(ERR.INVALID_ID);
  if (!from) return fail(ERR.INVALID_DATE);
  const norm = normalizeEmployeeSchedule(fields);
  if (!norm.ok) return norm;
  if (!(await assertEmployeeRow(db, cid, cand))) return fail(ERR.NOT_FOUND);
  const open = await assertOpenFrom(db, { companyId: cid, candidateId: cand, from });
  if (!open.ok) return open;
  const v = norm.value;
  const r = await db.query(
    `INSERT INTO employee_time_schedules
       (company_id, candidate_id, valid_from, follows_company, workday_start, workday_end,
        break_start, break_end, weekdays, created_by_user_id)
     VALUES ($1, $2, $3::date, $4, $5::time, $6::time, $7::time, $8::time, $9::smallint[], $10)
     ON CONFLICT (company_id, candidate_id, valid_from) DO UPDATE SET
       follows_company = EXCLUDED.follows_company,
       workday_start = EXCLUDED.workday_start,
       workday_end = EXCLUDED.workday_end,
       break_start = EXCLUDED.break_start,
       break_end = EXCLUDED.break_end,
       weekdays = EXCLUDED.weekdays,
       created_by_user_id = EXCLUDED.created_by_user_id,
       updated_at = NOW()
     RETURNING ${SCHEDULE_COLUMNS.replaceAll('s.', '')}`,
    [cid, cand, from, v.followsCompany, v.workdayStart, v.workdayEnd, v.breakStart, v.breakEnd, v.weekdays, userId]
  );
  return { ok: true, item: mapScheduleRow(r.rows[0]) };
}

export async function deleteEmployeeSchedule(dbOrQuery, { companyId, candidateId, id }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const sid = Number(id);
  if (![cid, cand, sid].every(validId)) return fail(ERR.INVALID_ID);
  const cur = await db.query(
    `SELECT to_char(valid_from, 'YYYY-MM-DD') AS "validFrom" FROM employee_time_schedules
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3`,
    [sid, cid, cand]
  );
  if (!cur.rowCount) return fail(ERR.NOT_FOUND);
  const open = await assertOpenFrom(db, { companyId: cid, candidateId: cand, from: cur.rows[0].validFrom });
  if (!open.ok) return open;
  await db.query('DELETE FROM employee_time_schedules WHERE id = $1 AND company_id = $2', [sid, cid]);
  return { ok: true, id: sid };
}

// ── Feriados ─────────────────────────────────────────────────────────────────

/** Concluded closures from `fromDay` on + unit ancestry, loaded once per write. */
async function loadClosureScopes(db, companyId, fromDay) {
  const [r, ancestorsOf] = await Promise.all([
    db.query(
      `SELECT to_char(period_start, 'YYYY-MM-DD') AS "start", to_char(period_end, 'YYYY-MM-DD') AS "end",
              org_unit_id AS "orgUnitId"
       FROM time_clock_closures
       WHERE company_id = $1 AND status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}' AND period_end >= $2::date
       LIMIT 500`,
      [companyId, fromDay]
    ),
    loadOrgUnitAncestors(db, companyId),
  ]);
  return { closures: r.rows || [], ancestorsOf };
}

/**
 * True when the holiday (or any yearly occurrence) falls in a concluded closure whose
 * scope overlaps the holiday scope (company-wide, same unit or ancestor/descendant).
 */
export function holidayHitsClosure({ closures, ancestorsOf }, { orgUnitId, day, recurrence }) {
  if (!closures.length) return false;
  const holidayChain = ancestorsOf(orgUnitId);
  const row = { day, recurrence, orgUnitId };
  return closures.some((k) => {
    const scoped = orgUnitId == null || k.orgUnitId == null
      || holidayChain.includes(Number(k.orgUnitId))
      || ancestorsOf(k.orgUnitId).includes(Number(orgUnitId));
    return scoped && expandHolidays([row], k.start, k.end).length > 0;
  });
}

export async function listHolidays(dbOrQuery, { companyId, year, q = '', page = 1, pageSize = HOLIDAYS_PAGE_SIZE }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!validId(cid)) return fail(ERR.COMPANY_REQUIRED);
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return fail(ERR.INVALID_DATE);
  const size = Math.min(100, Math.max(5, Number(pageSize) || HOLIDAYS_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid, `${y}-01-01`, `${y}-12-31`];
  let where = `h.company_id = $1
    AND ((h.recurrence = '${HOLIDAY_RECURRENCE.ONCE}' AND h.holiday_on BETWEEN $2::date AND $3::date)
      OR (h.recurrence = '${HOLIDAY_RECURRENCE.YEARLY}' AND h.holiday_on <= $3::date))`;
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND LOWER(h.name) LIKE $${params.length}`;
  }
  const countRes = await db.query(`SELECT COUNT(*)::int AS n FROM company_holidays h WHERE ${where}`, params);
  params.push(size, (pg - 1) * size);
  const [r, pathOf] = await Promise.all([
    db.query(
      `SELECT ${HOLIDAY_COLUMNS}, COALESCE(u.display_name, u.email) AS "createdByName"
       FROM company_holidays h
       LEFT JOIN users u ON u.id = h.created_by_user_id
       WHERE ${where}
       ORDER BY to_char(h.holiday_on, 'MM-DD'), h.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    loadOrgUnitPaths(db, cid),
  ]);
  return {
    ok: true,
    year: y,
    page: pg,
    pageSize: size,
    total: Number(countRes.rows[0]?.n) || 0,
    items: (r.rows || []).map((row) => {
      const item = mapHolidayRow(row);
      const occursOn = item.recurrence === HOLIDAY_RECURRENCE.YEARLY ? parseIsoDay(`${y}-${item.day.slice(5)}`) : item.day;
      return { ...item, occursOn, orgUnitPath: pathOf(item.orgUnitId), createdByName: row.createdByName || null };
    }),
  };
}

function normalizeHoliday({ name, day, recurrence, orgUnitId }) {
  const label = String(name || '').trim().slice(0, 120);
  const iso = parseIsoDay(day);
  const rec = recurrence || HOLIDAY_RECURRENCE.ONCE;
  const unit = orgUnitId != null && orgUnitId !== '' ? Number(orgUnitId) : null;
  if (!label || !HOLIDAY_RECURRENCES.includes(rec)) return fail(ERR.INVALID_DATA);
  if (!iso) return fail(ERR.INVALID_DATE);
  if (unit != null && !validId(unit)) return fail(ERR.INVALID_DATA);
  return { ok: true, value: { name: label, day: iso, recurrence: rec, orgUnitId: unit } };
}

function holidayWriteError(e) {
  if (e?.code === PG_UNIQUE_VIOLATION) return fail(ERR.HOLIDAY_DUPLICATE);
  if (e?.code === PG_FK_VIOLATION) return fail(ERR.NOT_FOUND);
  throw e;
}

/** Create (no id) or update a holiday. Dates inside a concluded closure cannot change. */
export async function saveHoliday(dbOrQuery, { companyId, id = null, userId = null, ...fields }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!validId(cid)) return fail(ERR.COMPANY_REQUIRED);
  const norm = normalizeHoliday(fields);
  if (!norm.ok) return norm;
  const v = norm.value;
  const hid = id != null ? Number(id) : null;
  if (hid != null && !validId(hid)) return fail(ERR.INVALID_ID);

  let old = null;
  if (hid != null) {
    const cur = await db.query(
      `SELECT ${HOLIDAY_COLUMNS} FROM company_holidays h WHERE h.id = $1 AND h.company_id = $2`,
      [hid, cid]
    );
    if (!cur.rowCount) return fail(ERR.NOT_FOUND);
    old = mapHolidayRow(cur.rows[0]);
  }
  const scopes = await loadClosureScopes(db, cid, [v.day, old?.day].filter(Boolean).sort()[0]);
  if ((old && holidayHitsClosure(scopes, old)) || holidayHitsClosure(scopes, v)) {
    return fail(ERR.TIME_CLOCK_PERIOD_CLOSED);
  }

  try {
    const r = hid == null
      ? await db.query(
        `INSERT INTO company_holidays (company_id, org_unit_id, name, holiday_on, recurrence, source, created_by_user_id)
         VALUES ($1, $2, $3, $4::date, $5, '${HOLIDAY_SOURCE.MANUAL}', $6)
         RETURNING id`,
        [cid, v.orgUnitId, v.name, v.day, v.recurrence, userId]
      )
      : await db.query(
        `UPDATE company_holidays
         SET org_unit_id = $3, name = $4, holiday_on = $5::date, recurrence = $6, updated_at = NOW()
         WHERE id = $1 AND company_id = $2
         RETURNING id`,
        [hid, cid, v.orgUnitId, v.name, v.day, v.recurrence]
      );
    return { ok: true, id: Number(r.rows[0].id), ...v };
  } catch (e) {
    return holidayWriteError(e);
  }
}

export async function deleteHoliday(dbOrQuery, { companyId, id }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const hid = Number(id);
  if (!validId(cid) || !validId(hid)) return fail(ERR.INVALID_ID);
  const cur = await db.query(
    `SELECT ${HOLIDAY_COLUMNS} FROM company_holidays h WHERE h.id = $1 AND h.company_id = $2`,
    [hid, cid]
  );
  if (!cur.rowCount) return fail(ERR.NOT_FOUND);
  const old = mapHolidayRow(cur.rows[0]);
  if (holidayHitsClosure(await loadClosureScopes(db, cid, old.day), old)) return fail(ERR.TIME_CLOCK_PERIOD_CLOSED);
  await db.query('DELETE FROM company_holidays WHERE id = $1 AND company_id = $2', [hid, cid]);
  return { ok: true, id: hid, name: old.name, day: old.day };
}

/** Company-wide national holidays of `year`; existing dates and closed periods are skipped. */
export async function importNationalHolidays(dbOrQuery, { companyId, year, userId = null }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const y = Number(year);
  if (!validId(cid)) return fail(ERR.COMPANY_REQUIRED);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return fail(ERR.INVALID_DATE);
  const list = nationalHolidays(y);
  const scopes = await loadClosureScopes(db, cid, `${y}-01-01`);
  const open = list.filter((h) => !holidayHitsClosure(scopes, { orgUnitId: null, day: h.day, recurrence: HOLIDAY_RECURRENCE.ONCE }));
  const closed = list.length - open.length;
  let inserted = 0;
  if (open.length) {
    const r = await db.query(
      `INSERT INTO company_holidays (company_id, org_unit_id, name, holiday_on, recurrence, source, created_by_user_id)
       SELECT $1, NULL, n, d::date, '${HOLIDAY_RECURRENCE.ONCE}', '${HOLIDAY_SOURCE.NATIONAL}', $4
       FROM unnest($2::text[], $3::text[]) AS u(n, d)
       ON CONFLICT (company_id, (COALESCE(org_unit_id, 0)), holiday_on) DO NOTHING
       RETURNING id`,
      [cid, open.map((h) => h.name), open.map((h) => h.day), userId]
    );
    inserted = r.rowCount || 0;
  }
  return { ok: true, year: y, total: list.length, inserted, existing: open.length - inserted, closed };
}
