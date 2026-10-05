/**
 * Per-person summary frozen at each time clock closure (migration 147) and the
 * collaborator's acknowledgment of that mirror: sign (typed name + consent) or dispute
 * (reason). A closed period is locked, so a summary generated later for an older
 * closure has the same numbers it would have had at closing time.
 */

import crypto from 'node:crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYEE_NOTIF } from '../employee-notification-catalog.js';
import { notifyCandidates } from '../employee-notifications.js';
import { NOTIF } from '../manager-notification-catalog.js';
import { notifyCompanyManagers } from '../manager-notifications.js';
import {
  TIME_CLOCK_ACK_STATUS,
  TIME_CLOCK_ACK_STATUSES,
  TIME_CLOCK_CLOSURE_STATUS,
  TIME_DAY_OCCURRENCE,
} from '../domain-status.js';
import { HOUR_BANK_BATCH, listClosureScopePeople, loadTimeDayInputs } from './hour-bank-balance.js';
import { loadOrgUnitPaths } from './org-units.js';
import { DEFAULT_SCHEDULE, csvCell, getCompanyTimeSchedule } from './time-clock.js';
import { resolveTimeClockEligibility } from './time-clock-eligibility.js';
import { addDaysIso, summarizeTimeDay } from './time-day-summary.js';

export const TIME_CLOCK_ACK_CONSENT_VERSION = 'v1-mirror-ack';
export const CLOSURE_PEOPLE_PAGE_SIZE = 25;
export const CLOSURE_PEOPLE_CSV_CAP = 5000;
export const EMPLOYEE_CLOSURE_ACK_LIMIT = 12;
export const TIME_CLOCK_DISPUTE_NOTE_MIN = 10;

const fail = (errorCode) => ({ ok: false, errorCode });

const TOTAL_KEYS = Object.freeze([
  'expectedMinutes',
  'workedMinutes',
  'extraMinutes',
  'missingMinutes',
  'workdays',
  'absenceDays',
  'justifiedDays',
  'incompleteDays',
]);

/**
 * Pure: totals for one person over [from, to]. Days before `startDate` expect nothing.
 * `dayInfo(iso)` → { schedule, isWorkday, holiday }; `punchesFor` / `justFor` by day.
 */
export function totalsForPeriod({ from, to, startDate = null, dayInfo, punchesFor, justFor }) {
  const t = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]));
  for (let iso = from; iso <= to; iso = addDaysIso(iso, 1)) {
    const info = dayInfo(iso);
    const s = summarizeTimeDay({
      punches: punchesFor(iso),
      schedule: info.schedule,
      justification: justFor(iso),
      isWorkday: info.isWorkday,
      isToday: false,
      beforeStart: Boolean(startDate && iso < startDate),
      holiday: info.holiday,
    });
    t.expectedMinutes += s.expectedMinutes;
    t.workedMinutes += s.workedMinutes;
    t.extraMinutes += s.extraMinutes;
    t.missingMinutes += s.missingMinutes;
    if (s.expectedMinutes > 0) t.workdays += 1;
    if (s.occurrence === TIME_DAY_OCCURRENCE.ABSENCE) t.absenceDays += 1;
    if (s.occurrence === TIME_DAY_OCCURRENCE.JUSTIFIED) t.justifiedDays += 1;
    if (s.occurrence === TIME_DAY_OCCURRENCE.INCOMPLETE) t.incompleteDays += 1;
  }
  return t;
}

/** sha256 of period + totals: the exact numbers the collaborator signs. */
export function closureSnapshotHash({ closureId, candidateId, periodStart, periodEnd, totals }) {
  const parts = [closureId, candidateId, periodStart, periodEnd, ...TOTAL_KEYS.map((k) => Number(totals[k]) || 0)];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Freeze totals for everyone with time clock in the closure scope. Idempotent (existing
 * rows are kept). `sequential` when running on a transaction client.
 * @returns {Promise<{ ok: true, count: number, candidateIds: number[] }>}
 */
export async function snapshotClosurePeople(dbOrQuery, {
  companyId,
  closureId,
  periodStart,
  periodEnd,
  orgUnitId = null,
  schedule = null,
  sequential = false,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const sched = schedule || (await getCompanyTimeSchedule(db, { companyId: cid })).schedule || DEFAULT_SCHEDULE;
  const tz = sched.timezone || DEFAULT_SCHEDULE.timezone;
  const people = (await listClosureScopePeople(db, { companyId: cid, orgUnitId }))
    .filter((p) => resolveTimeClockEligibility({ workFormat: p.workFormat, override: p.timeClockOverride }).enabled)
    .filter((p) => !p.startDate || p.startDate <= periodEnd);
  const inserted = [];
  for (let i = 0; i < people.length; i += HOUR_BANK_BATCH) {
    const chunk = people.slice(i, i + HOUR_BANK_BATCH);
    const inputs = await loadTimeDayInputs(db, {
      companyId: cid,
      candidateIds: chunk.map((p) => p.id),
      from: periodStart,
      to: periodEnd,
      timezone: tz,
      sequential,
    });
    const rows = chunk.map((person) => {
      const dayInfo = inputs.calendarFor(sched, person);
      const totals = totalsForPeriod({
        from: periodStart,
        to: periodEnd,
        startDate: person.startDate,
        dayInfo,
        punchesFor: (iso) => inputs.punches.get(`${person.id}|${iso}`) || [],
        justFor: (iso) => inputs.justs.get(`${person.id}|${iso}`) || null,
      });
      const hash = closureSnapshotHash({ closureId, candidateId: person.id, periodStart, periodEnd, totals });
      return { id: person.id, totals, hash };
    });
    const col = (k) => rows.map((r) => r.totals[k]);
    const r = await db.query(
      `INSERT INTO time_clock_closure_people
         (closure_id, company_id, candidate_id, expected_minutes, worked_minutes, extra_minutes,
          missing_minutes, workdays, absence_days, justified_days, incomplete_days, snapshot_hash)
       SELECT $1, $2, u.c, u.e, u.w, u.x, u.m, u.d, u.a, u.j, u.i, u.h
       FROM unnest($3::bigint[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[],
                   $10::int[], $11::int[], $12::text[]) AS u(c, e, w, x, m, d, a, j, i, h)
       ON CONFLICT (closure_id, candidate_id) DO NOTHING
       RETURNING candidate_id AS "candidateId"`,
      [
        closureId,
        cid,
        rows.map((r0) => r0.id),
        col('expectedMinutes'),
        col('workedMinutes'),
        col('extraMinutes'),
        col('missingMinutes'),
        col('workdays'),
        col('absenceDays'),
        col('justifiedDays'),
        col('incompleteDays'),
        rows.map((r0) => r0.hash),
      ]
    );
    for (const row of r.rows || []) inserted.push(Number(row.candidateId));
  }
  return { ok: true, count: inserted.length, candidateIds: inserted };
}

async function loadClosure(db, companyId, closureId) {
  const r = await db.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS "periodStart",
            to_char(period_end, 'YYYY-MM-DD') AS "periodEnd", org_unit_id AS "orgUnitId", status
     FROM time_clock_closures WHERE id = $2 AND company_id = $1`,
    [companyId, closureId]
  );
  return r.rows[0] || null;
}

/**
 * Summary for an older closure created before migration 147 (or any closure without
 * rows). Only for concluded closures; the locked period keeps the numbers stable.
 */
export async function generateClosurePeople(dbOrQuery, { companyId, closureId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const kid = Number(closureId);
  if (![cid, kid].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const closure = await loadClosure(db, cid, kid);
  if (!closure) return fail(ERR.NOT_FOUND);
  if (closure.status !== TIME_CLOCK_CLOSURE_STATUS.CLOSED) return fail(ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE);
  const out = await snapshotClosurePeople(db, {
    companyId: cid,
    closureId: kid,
    periodStart: closure.periodStart,
    periodEnd: closure.periodEnd,
    orgUnitId: closure.orgUnitId != null ? Number(closure.orgUnitId) : null,
  });
  return { ...out, closure: { ...closure, id: kid } };
}

function mapPersonRow(row, pathOf = null) {
  return {
    candidateId: Number(row.candidateId),
    fullName: row.fullName || '',
    email: row.email || '',
    jobRoleName: row.jobRoleName || null,
    orgUnitPath: pathOf && row.orgUnitId != null ? pathOf(row.orgUnitId) || null : null,
    expectedMinutes: Number(row.expectedMinutes) || 0,
    workedMinutes: Number(row.workedMinutes) || 0,
    extraMinutes: Number(row.extraMinutes) || 0,
    missingMinutes: Number(row.missingMinutes) || 0,
    workdays: Number(row.workdays) || 0,
    absenceDays: Number(row.absenceDays) || 0,
    justifiedDays: Number(row.justifiedDays) || 0,
    incompleteDays: Number(row.incompleteDays) || 0,
    bankBalanceMinutes: row.bankBalanceMinutes != null ? Number(row.bankBalanceMinutes) : null,
    ackStatus: row.ackStatus,
    ackAt: row.ackAt || null,
    signerName: row.signerName || '',
    disputeNote: row.disputeNote || '',
    snapshotHash: row.snapshotHash,
  };
}

const PERSON_SELECT = `
  p.candidate_id AS "candidateId", c.full_name AS "fullName", c.email,
  c.org_unit_id AS "orgUnitId", jr.name AS "jobRoleName",
  p.expected_minutes AS "expectedMinutes", p.worked_minutes AS "workedMinutes",
  p.extra_minutes AS "extraMinutes", p.missing_minutes AS "missingMinutes",
  p.workdays, p.absence_days AS "absenceDays", p.justified_days AS "justifiedDays",
  p.incomplete_days AS "incompleteDays", b.balance_minutes AS "bankBalanceMinutes",
  p.ack_status AS "ackStatus", p.ack_at AS "ackAt", p.signer_name AS "signerName",
  p.dispute_note AS "disputeNote", p.snapshot_hash AS "snapshotHash"`;

const PERSON_FROM = `
  FROM time_clock_closure_people p
  JOIN candidates c ON c.id = p.candidate_id AND c.company_id = p.company_id
  LEFT JOIN job_roles jr ON jr.id = c.job_role_id AND jr.company_id = c.company_id
  LEFT JOIN time_clock_closure_balances b ON b.closure_id = p.closure_id AND b.candidate_id = p.candidate_id`;

function personWhere({ companyId, closureId, q, status }) {
  const params = [companyId, closureId];
  let where = 'p.company_id = $1 AND p.closure_id = $2';
  if (status && TIME_CLOCK_ACK_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND p.ack_status = $${params.length}`;
  }
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(c.full_name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length})`;
  }
  return { where, params };
}

/** Manager: paginated summary of one closure + counts by acknowledgment status. */
export async function listClosurePeople(dbOrQuery, {
  companyId,
  closureId,
  q = '',
  status = null,
  page = 1,
  pageSize = CLOSURE_PEOPLE_PAGE_SIZE,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const kid = Number(closureId);
  if (![cid, kid].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const closure = await loadClosure(db, cid, kid);
  if (!closure) return fail(ERR.NOT_FOUND);
  const size = Math.min(50, Math.max(5, Number(pageSize) || CLOSURE_PEOPLE_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const { where, params } = personWhere({ companyId: cid, closureId: kid, q, status });
  const [counts, total, rows, pathOf] = await Promise.all([
    db.query(
      `SELECT ack_status AS status, COUNT(*)::int AS n FROM time_clock_closure_people
       WHERE company_id = $1 AND closure_id = $2 GROUP BY ack_status`,
      [cid, kid]
    ),
    db.query(`SELECT COUNT(*)::int AS n ${PERSON_FROM} WHERE ${where}`, params),
    db.query(
      `SELECT ${PERSON_SELECT} ${PERSON_FROM} WHERE ${where}
       ORDER BY LOWER(c.full_name) ASC, p.candidate_id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pg - 1) * size]
    ),
    loadOrgUnitPaths(db, cid),
  ]);
  const byStatus = Object.fromEntries(TIME_CLOCK_ACK_STATUSES.map((s) => [s, 0]));
  for (const row of counts.rows || []) byStatus[row.status] = Number(row.n) || 0;
  const people = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    ok: true,
    closure: { ...closure, id: kid, orgUnitId: closure.orgUnitId != null ? Number(closure.orgUnitId) : null },
    counts: { ...byStatus, total: people },
    page: pg,
    pageSize: size,
    total: Number(total.rows[0]?.n) || 0,
    items: (rows.rows || []).map((row) => mapPersonRow(row, pathOf)),
  };
}

/** Manager: CSV of one closure (capped), with acknowledgment and integrity hash. */
export async function exportClosurePeopleCsv(dbOrQuery, { companyId, closureId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const kid = Number(closureId);
  if (![cid, kid].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const closure = await loadClosure(db, cid, kid);
  if (!closure) return fail(ERR.NOT_FOUND);
  const r = await db.query(
    `SELECT ${PERSON_SELECT} ${PERSON_FROM}
     WHERE p.company_id = $1 AND p.closure_id = $2
     ORDER BY LOWER(c.full_name) ASC, p.candidate_id ASC
     LIMIT ${CLOSURE_PEOPLE_CSV_CAP}`,
    [cid, kid]
  );
  const header = [
    'closure_id', 'period_start', 'period_end', 'candidate_id', 'name', 'email', 'job_role',
    'workdays', 'expected_minutes', 'worked_minutes', 'extra_minutes', 'missing_minutes',
    'absence_days', 'justified_days', 'incomplete_days', 'bank_balance_minutes',
    'ack_status', 'ack_at', 'signer_name', 'dispute_note', 'snapshot_hash',
  ];
  const lines = [header.join(',')];
  for (const row of r.rows || []) {
    const p = mapPersonRow(row);
    lines.push([
      kid, closure.periodStart, closure.periodEnd, p.candidateId, p.fullName, p.email, p.jobRoleName || '',
      p.workdays, p.expectedMinutes, p.workedMinutes, p.extraMinutes, p.missingMinutes,
      p.absenceDays, p.justifiedDays, p.incompleteDays, p.bankBalanceMinutes ?? '',
      p.ackStatus, p.ackAt instanceof Date ? p.ackAt.toISOString() : p.ackAt || '', p.signerName, p.disputeNote,
      p.snapshotHash,
    ].map(csvCell).join(','));
  }
  return {
    ok: true,
    closure: { ...closure, id: kid },
    count: (r.rows || []).length,
    csv: `${lines.join('\n')}\n`,
  };
}

const EMPLOYEE_SELECT = `
  p.closure_id AS "closureId", to_char(k.period_start, 'YYYY-MM-DD') AS "periodStart",
  to_char(k.period_end, 'YYYY-MM-DD') AS "periodEnd", k.closed_at AS "closedAt",
  p.expected_minutes AS "expectedMinutes", p.worked_minutes AS "workedMinutes",
  p.extra_minutes AS "extraMinutes", p.missing_minutes AS "missingMinutes",
  p.workdays, p.absence_days AS "absenceDays", p.justified_days AS "justifiedDays",
  p.incomplete_days AS "incompleteDays", b.balance_minutes AS "bankBalanceMinutes",
  p.ack_status AS "ackStatus", p.ack_at AS "ackAt", p.signer_name AS "signerName",
  p.dispute_note AS "disputeNote", p.snapshot_hash AS "snapshotHash"`;

function mapEmployeeRow(row) {
  return {
    closureId: Number(row.closureId),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    closedAt: row.closedAt,
    expectedMinutes: Number(row.expectedMinutes) || 0,
    workedMinutes: Number(row.workedMinutes) || 0,
    extraMinutes: Number(row.extraMinutes) || 0,
    missingMinutes: Number(row.missingMinutes) || 0,
    workdays: Number(row.workdays) || 0,
    absenceDays: Number(row.absenceDays) || 0,
    justifiedDays: Number(row.justifiedDays) || 0,
    incompleteDays: Number(row.incompleteDays) || 0,
    bankBalanceMinutes: row.bankBalanceMinutes != null ? Number(row.bankBalanceMinutes) : null,
    ackStatus: row.ackStatus,
    ackAt: row.ackAt || null,
    signerName: row.signerName || '',
    disputeNote: row.disputeNote || '',
    snapshotHash: row.snapshotHash,
  };
}

/** Collaborator: own mirrors of concluded closures, newest first (capped). */
export async function listEmployeeClosureAcks(dbOrQuery, { companyId, candidateId, limit = EMPLOYEE_CLOSURE_ACK_LIMIT }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (![cid, cand].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const lim = Math.min(EMPLOYEE_CLOSURE_ACK_LIMIT, Math.max(1, Number(limit) || EMPLOYEE_CLOSURE_ACK_LIMIT));
  const r = await db.query(
    `SELECT ${EMPLOYEE_SELECT}
     FROM time_clock_closure_people p
     JOIN time_clock_closures k ON k.id = p.closure_id AND k.company_id = p.company_id
     LEFT JOIN time_clock_closure_balances b ON b.closure_id = p.closure_id AND b.candidate_id = p.candidate_id
     WHERE p.company_id = $1 AND p.candidate_id = $2 AND k.status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
     ORDER BY p.closure_id DESC
     LIMIT $3`,
    [cid, cand, lim]
  );
  const items = (r.rows || []).map(mapEmployeeRow);
  return {
    ok: true,
    consentVersion: TIME_CLOCK_ACK_CONSENT_VERSION,
    pendingCount: items.filter((i) => i.ackStatus !== TIME_CLOCK_ACK_STATUS.SIGNED).length,
    items,
  };
}

/**
 * Collaborator signs or disputes one closed-period mirror.
 * Sign: pending or disputed → signed (name ≥ 3 + consent). Dispute: pending → disputed (reason).
 */
export async function acknowledgeClosure(dbOrQuery, {
  companyId,
  candidateId,
  closureId,
  action,
  signerName = '',
  consent = false,
  note = '',
  signerIp = null,
  signerUserAgent = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const kid = Number(closureId);
  if (![cid, cand, kid].every((n) => Number.isFinite(n) && n > 0)) return fail(ERR.INVALID_ID);
  const signing = action === TIME_CLOCK_ACK_STATUS.SIGNED;
  if (!signing && action !== TIME_CLOCK_ACK_STATUS.DISPUTED) return fail(ERR.INVALID_DATA);
  const name = String(signerName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const why = String(note || '').trim().slice(0, 1000);
  if (signing && name.length < 3) return fail(ERR.DP_SIGNATURE_NAME_REQUIRED);
  if (signing && !consent) return fail(ERR.TIME_CLOCK_ACK_CONSENT_REQUIRED);
  if (!signing && why.length < TIME_CLOCK_DISPUTE_NOTE_MIN) return fail(ERR.TIME_CLOCK_DISPUTE_NOTE_REQUIRED);

  const allowedFrom = signing
    ? [TIME_CLOCK_ACK_STATUS.PENDING, TIME_CLOCK_ACK_STATUS.DISPUTED]
    : [TIME_CLOCK_ACK_STATUS.PENDING];
  const r = await db.query(
    `UPDATE time_clock_closure_people p
     SET ack_status = $4, ack_at = NOW(),
         signer_name = CASE WHEN $4 = '${TIME_CLOCK_ACK_STATUS.SIGNED}' THEN $5 ELSE p.signer_name END,
         consent_version = CASE WHEN $4 = '${TIME_CLOCK_ACK_STATUS.SIGNED}' THEN $6 ELSE p.consent_version END,
         dispute_note = CASE WHEN $4 = '${TIME_CLOCK_ACK_STATUS.DISPUTED}' THEN $7 ELSE p.dispute_note END,
         signer_ip = $8, signer_user_agent = $9
     FROM time_clock_closures k
     WHERE p.company_id = $1 AND p.candidate_id = $2 AND p.closure_id = $3
       AND k.id = p.closure_id AND k.company_id = p.company_id
       AND k.status = '${TIME_CLOCK_CLOSURE_STATUS.CLOSED}'
       AND p.ack_status = ANY($10::text[])
     RETURNING p.closure_id AS "closureId"`,
    [
      cid, cand, kid, action, name, TIME_CLOCK_ACK_CONSENT_VERSION, why,
      signerIp ? String(signerIp).slice(0, 64) : null,
      signerUserAgent ? String(signerUserAgent).slice(0, 300) : null,
      allowedFrom,
    ]
  );
  if (!r.rowCount) {
    const cur = await db.query(
      `SELECT p.ack_status AS "ackStatus", k.status
       FROM time_clock_closure_people p
       JOIN time_clock_closures k ON k.id = p.closure_id AND k.company_id = p.company_id
       WHERE p.company_id = $1 AND p.candidate_id = $2 AND p.closure_id = $3`,
      [cid, cand, kid]
    );
    const row = cur.rows[0];
    if (!row) return fail(ERR.NOT_FOUND);
    if (row.status !== TIME_CLOCK_CLOSURE_STATUS.CLOSED) return fail(ERR.TIME_CLOCK_CLOSURE_NOT_ACTIVE);
    return fail(ERR.TIME_CLOCK_ACK_LOCKED);
  }
  const item = await db.query(
    `SELECT ${EMPLOYEE_SELECT}
     FROM time_clock_closure_people p
     JOIN time_clock_closures k ON k.id = p.closure_id AND k.company_id = p.company_id
     LEFT JOIN time_clock_closure_balances b ON b.closure_id = p.closure_id AND b.candidate_id = p.candidate_id
     WHERE p.company_id = $1 AND p.candidate_id = $2 AND p.closure_id = $3`,
    [cid, cand, kid]
  );
  return { ok: true, item: mapEmployeeRow(item.rows[0]) };
}

const NOTIFY_CHUNK = 200;

/** In-app/push "mirror ready" to everyone in a closure summary (chunked, deduped per closure). */
export async function notifyClosureMirrorsReady(dbOrQuery, { companyId, closureId, periodStart, periodEnd, candidateIds }) {
  const ids = [...new Set((candidateIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  let inserted = 0;
  for (let i = 0; i < ids.length; i += NOTIFY_CHUNK) {
    const r = await notifyCandidates(dbOrQuery, {
      companyId,
      candidateIds: ids.slice(i, i + NOTIFY_CHUNK),
      type: EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE,
      entityType: 'time_clock_closure',
      entityId: closureId,
      dedupeKeyPrefix: `tc_mirror:${closureId}`,
      payload: { closureId, from: periodStart, to: periodEnd },
    });
    inserted += Number(r?.inserted) || 0;
  }
  return { inserted };
}

/** Tells the company's managers that a collaborator disputed a mirror. */
export async function notifyClosureDisputed(dbOrQuery, { companyId, candidateId, candidateName, item }) {
  return notifyCompanyManagers(dbOrQuery, {
    companyId,
    type: NOTIF.TIME_MIRROR_DISPUTED,
    entityType: 'time_clock_closure',
    entityId: item.closureId,
    dedupeKey: `tc_mirror_dispute:${item.closureId}:${candidateId}`,
    payload: {
      candidateId,
      candidateName,
      name: candidateName,
      closureId: item.closureId,
      from: item.periodStart,
      to: item.periodEnd,
    },
  });
}
