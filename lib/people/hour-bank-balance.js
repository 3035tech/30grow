/**
 * Banco de horas calculado (migration 143).
 *
 * Saldo em D = base + Σ dias (extra − falta do espelho, se a pessoa registra ponto)
 *            + lançamentos aprovados do RH / colaborador, com teto da empresa.
 * Base = saldo congelado no último fechamento (time_clock_closure_balances) ou, sem
 * fechamento, a abertura: lançamentos aprovados antes de hour_bank_started_on (inclui os
 * créditos antigos gerados do ponto). Antes do início vale o livro de lançamentos.
 *
 * Tudo em lote: um grupo de pessoas custa um número fixo de queries.
 */

import { asDb } from '../ae/as-db.js';
import {
  EMPLOYMENT_STATUS,
  HOUR_BANK_ENTRY_KIND,
  HOUR_BANK_SOURCE,
  HOUR_BANK_STATUS,
  TIME_CLOCK_CLOSURE_STATUS,
} from '../domain-status.js';
import { DEFAULT_SCHEDULE, getCompanyTimeSchedule, isoDayInTz } from './time-clock.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';
import { buildPersonCalendar, expandHolidays, loadEmployeeSchedules, loadHolidaysInRange } from './time-clock-calendar.js';
import { loadOrgUnitAncestors } from './org-units.js';
import { addDaysIso, stepHourBank, summarizeTimeDay } from './time-day-summary.js';

export const HOUR_BANK_BATCH = 100;

const SIGNED = `CASE WHEN entry_kind = '${HOUR_BANK_ENTRY_KIND.CREDIT}' THEN minutes ELSE -minutes END`;

/** Day contribution: only people with time clock accrue extra/missing. */
export function hourBankDayNet(summary, timeClockEnabled) {
  return timeClockEnabled ? summary.extraMinutes - summary.missingMinutes : 0;
}

export function hourBankStartedOn(schedule, fallbackDay) {
  return schedule?.hourBankStartedOn || fallbackDay;
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Approved ledger sum per person with work_on <= day (pre-start history). */
async function ledgerSums(db, companyId, ids, { before = null, upTo = null }) {
  const r = await db.query(
    `SELECT candidate_id AS "candidateId", COALESCE(SUM(${SIGNED}), 0)::int AS total
     FROM employee_hour_bank_entries
     WHERE company_id = $1 AND candidate_id = ANY($2::bigint[])
       AND status = '${HOUR_BANK_STATUS.APPROVED}'
       AND ($3::date IS NULL OR work_on < $3::date)
       AND ($4::date IS NULL OR work_on <= $4::date)
     GROUP BY candidate_id`,
    [companyId, ids, before, upTo]
  );
  return new Map((r.rows || []).map((row) => [Number(row.candidateId), Number(row.total) || 0]));
}

/** Frozen balances of concluded closures, per person: latest period_end in [minEnd, upTo]. */
async function latestSnapshots(db, companyId, ids, { minEnd, upTo }) {
  const r = await db.query(
    `SELECT DISTINCT ON (b.candidate_id)
            b.candidate_id AS "candidateId", b.balance_minutes AS balance,
            to_char(k.period_end, 'YYYY-MM-DD') AS "periodEnd"
     FROM time_clock_closure_balances b
     JOIN time_clock_closures k ON k.id = b.closure_id AND k.company_id = b.company_id
     WHERE b.company_id = $1 AND b.candidate_id = ANY($2::bigint[])
       AND k.status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
       AND k.period_end >= $3::date AND k.period_end <= $4::date
     ORDER BY b.candidate_id, k.period_end DESC`,
    [companyId, ids, minEnd, upTo]
  );
  return new Map((r.rows || []).map((row) => [Number(row.candidateId), {
    balance: Number(row.balance) || 0,
    periodEnd: row.periodEnd,
  }]));
}

/** day → frozen balance for one person in [from, to] (mirror re-anchors on these days). */
export async function loadSnapshotAnchors(dbOrQuery, { companyId, candidateId, from, to }) {
  const db = asDb(dbOrQuery);
  const r = await db.query(
    `SELECT to_char(k.period_end, 'YYYY-MM-DD') AS day, b.balance_minutes AS balance
     FROM time_clock_closure_balances b
     JOIN time_clock_closures k ON k.id = b.closure_id AND k.company_id = b.company_id
     WHERE b.company_id = $1 AND b.candidate_id = $2
       AND k.status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
       AND k.period_end BETWEEN $3::date AND $4::date
     LIMIT 50`,
    [Number(companyId), Number(candidateId), from, to]
  );
  return new Map((r.rows || []).map((row) => [row.day, Number(row.balance) || 0]));
}

/**
 * Balances at `upTo` (default today) for up to HOUR_BANK_BATCH people.
 * Without `upTo` (current balance), approved manual entries dated after today count too
 * (e.g. an approved future day off), so balance checks cannot be bypassed.
 * `periodFrom` adds extra/missing/manual totals for [periodFrom, upTo] (closure snapshot).
 * @returns {Promise<Map<number, { balanceMinutes: number, overCapMinutes: number,
 *   extraMinutes: number, missingMinutes: number, manualMinutes: number }>>}
 */
export async function computeHourBankBalances(dbOrQuery, {
  companyId,
  candidateIds,
  upTo = null,
  schedule = null,
  periodFrom = null,
  sequential = false,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const ids = [...new Set((candidateIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))]
    .slice(0, HOUR_BANK_BATCH);
  const out = new Map();
  if (!ids.length) return out;

  const sched = schedule || (await getCompanyTimeSchedule(db, { companyId: cid })).schedule || DEFAULT_SCHEDULE;
  const tz = sched.timezone || DEFAULT_SCHEDULE.timezone;
  const today = isoDayInTz(new Date(), tz);
  const end = upTo && upTo < today ? upTo : today;
  const includeFuture = !upTo;
  const startedOn = hourBankStartedOn(sched, today);
  const cap = Number.isFinite(Number(sched.hourBankMaxMinutes)) ? Number(sched.hourBankMaxMinutes) : null;
  const blank = { overCapMinutes: 0, extraMinutes: 0, missingMinutes: 0, manualMinutes: 0 };

  if (end < startedOn) {
    const sums = await ledgerSums(db, cid, ids, { upTo: end });
    for (const id of ids) out.set(id, { ...blank, balanceMinutes: sums.get(id) || 0 });
    return out;
  }

  const [people, snapshots, opening, future] = await gather(sequential, [
    () => db.query(
      `SELECT id, org_unit_id AS "orgUnitId", COALESCE(start_date, hired_at::date) AS "startDate",
              work_format AS "workFormat", time_clock_override AS "timeClockOverride"
       FROM candidates
       WHERE company_id = $1 AND id = ANY($2::bigint[])`,
      [cid, ids]
    ),
    () => latestSnapshots(db, cid, ids, { minEnd: startedOn, upTo: end }),
    () => ledgerSums(db, cid, ids, { before: startedOn }),
    () => (includeFuture
      ? db.query(
        `SELECT candidate_id AS "candidateId", COALESCE(SUM(${SIGNED}), 0)::int AS total
         FROM employee_hour_bank_entries
         WHERE company_id = $1 AND candidate_id = ANY($2::bigint[])
           AND status = '${HOUR_BANK_STATUS.APPROVED}' AND source <> '${HOUR_BANK_SOURCE.TIME_CLOCK}'
           AND work_on > $3::date
         GROUP BY candidate_id`,
        [cid, ids, end]
      ).then((r) => new Map((r.rows || []).map((row) => [Number(row.candidateId), Number(row.total) || 0])))
      : new Map()),
  ]);

  const windowStart = new Map();
  for (const id of ids) {
    const snap = snapshots.get(id);
    windowStart.set(id, snap ? addDaysIso(snap.periodEnd, 1) : startedOn);
  }
  const minStart = [...windowStart.values()].sort()[0];

  const [punchRes, justRes, manualRes, schedules, holidayRows, ancestorsOf] = await gather(sequential, [
    () => db.query(
      `SELECT candidate_id AS "candidateId", punched_at AS "punchedAt", punch_kind AS "punchKind",
              to_char(punched_at AT TIME ZONE $5, 'YYYY-MM-DD') AS day
       FROM employee_time_punches
       WHERE company_id = $1 AND candidate_id = ANY($2::bigint[]) AND voided_at IS NULL
         AND punched_at >= ($3::timestamp AT TIME ZONE $5)
         AND punched_at < (($4::timestamp + INTERVAL '1 day') AT TIME ZONE $5)
       ORDER BY punched_at ASC`,
      [cid, ids, minStart, end, tz]
    ),
    () => db.query(
      `SELECT candidate_id AS "candidateId", to_char(work_on, 'YYYY-MM-DD') AS day, reason,
              to_char(excused_start, 'HH24:MI') AS "excusedStart", to_char(excused_end, 'HH24:MI') AS "excusedEnd"
       FROM employee_time_day_justifications
       WHERE company_id = $1 AND candidate_id = ANY($2::bigint[]) AND work_on BETWEEN $3::date AND $4::date`,
      [cid, ids, minStart, end]
    ),
    () => db.query(
      `SELECT candidate_id AS "candidateId", to_char(work_on, 'YYYY-MM-DD') AS day, SUM(${SIGNED})::int AS delta
       FROM employee_hour_bank_entries
       WHERE company_id = $1 AND candidate_id = ANY($2::bigint[])
         AND status = '${HOUR_BANK_STATUS.APPROVED}' AND source <> '${HOUR_BANK_SOURCE.TIME_CLOCK}'
         AND work_on BETWEEN $3::date AND $4::date
       GROUP BY candidate_id, work_on`,
      [cid, ids, minStart, end]
    ),
    () => loadEmployeeSchedules(db, { companyId: cid, candidateIds: ids, upTo: end }),
    () => loadHolidaysInRange(db, { companyId: cid, from: minStart, to: end }),
    () => loadOrgUnitAncestors(db, cid),
  ]);

  const keyed = (rows, map = (r) => r) => {
    const m = new Map();
    for (const row of rows || []) {
      const k = `${row.candidateId}|${row.day}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(map(row));
    }
    return m;
  };
  const punches = keyed(punchRes.rows);
  const justs = new Map((justRes.rows || []).map((j) => [`${j.candidateId}|${j.day}`, j]));
  const manual = new Map((manualRes.rows || []).map((m) => [`${m.candidateId}|${m.day}`, Number(m.delta) || 0]));
  const occurrences = expandHolidays(holidayRows, minStart, end);

  for (const person of people.rows || []) {
    const id = Number(person.id);
    const snap = snapshots.get(id);
    let balance = snap ? snap.balance : opening.get(id) || 0;
    const enabled = resolveTimeClockEligibility({
      workFormat: person.workFormat,
      override: person.timeClockOverride,
    }).enabled;
    const startDate = toIso(person.startDate);
    const dayInfo = buildPersonCalendar({
      companySchedule: sched,
      scheduleRows: schedules.get(id) || [],
      holidayOccurrences: occurrences,
      unitChain: ancestorsOf(person.orgUnitId),
    });
    const totals = { ...blank };
    for (let iso = windowStart.get(id); iso <= end; iso = addDaysIso(iso, 1)) {
      const key = `${id}|${iso}`;
      const info = dayInfo(iso);
      const summary = summarizeTimeDay({
        punches: punches.get(key) || [],
        schedule: info.schedule,
        justification: justs.get(key) || null,
        isWorkday: enabled && info.isWorkday,
        isToday: iso === today,
        beforeStart: Boolean(startDate && iso < startDate),
        holiday: info.holiday,
      });
      const net = hourBankDayNet(summary, enabled);
      const delta = manual.get(key) || 0;
      const step = stepHourBank(balance, { net, manual: delta, cap });
      balance = step.balance;
      if (!periodFrom || iso >= periodFrom) {
        totals.overCapMinutes += step.overCap;
        if (enabled) {
          totals.extraMinutes += summary.extraMinutes;
          totals.missingMinutes += summary.missingMinutes;
        }
        totals.manualMinutes += delta;
      }
    }
    const ahead = future.get(id) || 0;
    if (ahead) balance = stepHourBank(balance, { manual: ahead, cap }).balance;
    out.set(id, { ...totals, balanceMinutes: balance });
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { ...blank, balanceMinutes: 0 });
  return out;
}

/** A transaction client runs one query at a time; pooled callers fan out. */
async function gather(sequential, tasks) {
  if (!sequential) return Promise.all(tasks.map((task) => task()));
  const out = [];
  for (const task of tasks) out.push(await task());
  return out;
}

/** Balance for any number of people, in HOUR_BANK_BATCH chunks. */
export async function computeHourBankBalancesChunked(dbOrQuery, { candidateIds, ...opts }) {
  const all = new Map();
  const ids = [...new Set((candidateIds || []).map(Number))];
  for (let i = 0; i < ids.length; i += HOUR_BANK_BATCH) {
    const part = await computeHourBankBalances(dbOrQuery, { ...opts, candidateIds: ids.slice(i, i + HOUR_BANK_BATCH) });
    for (const [k, v] of part) all.set(k, v);
  }
  return all;
}

/**
 * Freeze balances at the end of a new closure for everyone in its scope (company or unit
 * + descendants). Runs inside the closure transaction; skipped when the bank is off or the
 * period ends before the bank start.
 */
export async function snapshotHourBankForClosure(client, { companyId, closureId, periodStart, periodEnd, orgUnitId, schedule }) {
  if (!schedule?.hourBankEnabled) return { ok: true, count: 0 };
  const startedOn = hourBankStartedOn(schedule, periodEnd);
  if (periodEnd < startedOn) return { ok: true, count: 0 };
  const people = await client.query(
    `WITH RECURSIVE scope AS (
       SELECT id FROM org_units WHERE company_id = $1 AND id = $2::int
       UNION ALL
       SELECT u.id FROM org_units u JOIN scope s ON u.parent_id = s.id WHERE u.company_id = $1
     )
     SELECT c.id FROM candidates c
     WHERE c.company_id = $1 AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       AND ($2::int IS NULL OR c.org_unit_id IN (SELECT id FROM scope))`,
    [companyId, orgUnitId]
  );
  const ids = (people.rows || []).map((r) => Number(r.id));
  const balances = await computeHourBankBalancesChunked(client, {
    companyId,
    candidateIds: ids,
    upTo: periodEnd,
    schedule,
    periodFrom: periodStart < startedOn ? startedOn : periodStart,
    sequential: true,
  });
  if (!balances.size) return { ok: true, count: 0 };
  const rows = [...balances.entries()];
  await client.query(
    `INSERT INTO time_clock_closure_balances
       (closure_id, company_id, candidate_id, balance_minutes, extra_minutes, missing_minutes, manual_minutes)
     SELECT $1, $2, c, b, e, m, x
     FROM unnest($3::bigint[], $4::int[], $5::int[], $6::int[], $7::int[]) AS u(c, b, e, m, x)
     ON CONFLICT (closure_id, candidate_id) DO NOTHING`,
    [
      closureId,
      companyId,
      rows.map(([id]) => id),
      rows.map(([, v]) => v.balanceMinutes),
      rows.map(([, v]) => v.extraMinutes),
      rows.map(([, v]) => v.missingMinutes),
      rows.map(([, v]) => v.manualMinutes),
    ]
  );
  return { ok: true, count: rows.length };
}
