/**
 * Internal compensation timeline for employees — not payroll / holerite.
 */

import { asDb } from '../ae/as-db.js';
import { stripSalary, salaryAmountNumber } from '../br-masks.js';
import { ERR } from '../api-error-codes.js';
import {
  COMPENSATION_APPROVAL_STATUS,
  COMPENSATION_APPROVAL_STATUSES,
  COMPENSATION_EVENT_TYPE,
  COMPENSATION_EVENT_TYPES,
  EMPLOYMENT_STATUS,
  OFFER_STATUS,
} from '../domain-status.js';
import { sanitizeRichTextHtml } from '../sanitize-html.js';

const LIST_CAP = 80;
const NOTES_MAX = 4000;

/** Compare current pay to optional market band on the job role. */
export function compareAmountToMarketBand(currentAmount, marketMin, marketMax) {
  const cur = salaryAmountNumber(currentAmount);
  const lo = salaryAmountNumber(marketMin);
  const hi = salaryAmountNumber(marketMax);
  if (cur == null) return { status: 'no_salary', current: null, min: lo, max: hi };
  if (lo == null && hi == null) return { status: 'no_band', current: cur, min: null, max: null };
  if (lo != null && cur < lo) {
    const gap = lo - cur;
    const pct = lo > 0 ? Math.round((gap / lo) * 100) : null;
    return { status: 'below', current: cur, min: lo, max: hi, gap, pctBelow: pct };
  }
  if (hi != null && cur > hi) {
    const gap = cur - hi;
    const pct = hi > 0 ? Math.round((gap / hi) * 100) : null;
    return { status: 'above', current: cur, min: lo, max: hi, gap, pctAbove: pct };
  }
  return { status: 'in_band', current: cur, min: lo, max: hi };
}

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normalizeEventType(raw, fallback = COMPENSATION_EVENT_TYPE.ADJUSTMENT) {
  const s = String(raw || '').trim().toLowerCase();
  return COMPENSATION_EVENT_TYPES.includes(s) ? s : fallback;
}

function mapRow(r) {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    candidateId: Number(r.candidateId),
    eventType: r.eventType,
    amount: r.amount,
    effectiveDate: dateOrNull(r.effectiveDate),
    notes: r.notes || '',
    approvalStatus: r.approvalStatus || COMPENSATION_APPROVAL_STATUS.APPROVED,
    sourceReviewId: r.sourceReviewId != null ? Number(r.sourceReviewId) : null,
    sourceCycleId: r.sourceCycleId != null ? Number(r.sourceCycleId) : null,
    createdByUserId: r.createdByUserId != null ? Number(r.createdByUserId) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function assertInternalPerson(db, { companyId, candidateId }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const r = await db.query(
    `SELECT id, employment_status AS "employmentStatus"
     FROM candidates
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [cand, cid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const status = r.rows[0].employmentStatus;
  if (status !== EMPLOYMENT_STATUS.EMPLOYEE && status !== EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  return { ok: true, employmentStatus: status };
}

export async function getAcceptedOfferHint(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) return null;

  const r = await db.query(
    `SELECT offer_salary AS "offerSalary",
            offer_start_date AS "offerStartDate",
            offer_status AS "offerStatus"
     FROM vacancy_candidates
     WHERE company_id = $1 AND candidate_id = $2
       AND offer_status = '${OFFER_STATUS.ACCEPTED}'
       AND NULLIF(TRIM(offer_salary), '') IS NOT NULL
     ORDER BY offer_accepted_at DESC NULLS LAST, updated_at DESC, id DESC
     LIMIT 1`,
    [cid, cand]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    offerSalary: row.offerSalary,
    offerStartDate: dateOrNull(row.offerStartDate),
    offerStatus: row.offerStatus,
  };
}

export async function listCompensationEvents(dbOrQuery, { companyId, candidateId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const scoped = await assertInternalPerson(db, { companyId, candidateId });
  if (!scoped.ok) return scoped;

  const cap = Math.min(LIST_CAP, Math.max(1, Number(limit) || LIST_CAP));
  const r = await db.query(
    `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
            event_type AS "eventType", amount,
            effective_date AS "effectiveDate", notes,
            approval_status AS "approvalStatus",
            source_review_id AS "sourceReviewId",
            source_cycle_id AS "sourceCycleId",
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM employee_compensation_events
     WHERE company_id = $1 AND candidate_id = $2
     ORDER BY effective_date DESC, id DESC
     LIMIT $3`,
    [Number(companyId), Number(candidateId), cap]
  );
  const items = (r.rows || []).map(mapRow);
  const current =
    items.find((i) => i.approvalStatus === COMPENSATION_APPROVAL_STATUS.APPROVED) || null;
  return {
    ok: true,
    items,
    current,
    employmentStatus: scoped.employmentStatus,
  };
}

export async function createCompensationEvent(dbOrQuery, {
  companyId,
  candidateId,
  eventType,
  amount,
  effectiveDate,
  notes = '',
  createdByUserId = null,
  approvalStatus = COMPENSATION_APPROVAL_STATUS.APPROVED,
  sourceReviewId = null,
  sourceCycleId = null,
}) {
  const db = asDb(dbOrQuery);
  const scoped = await assertInternalPerson(db, { companyId, candidateId });
  if (!scoped.ok) return scoped;
  if (scoped.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const normalizedAmount = stripSalary(amount);
  if (!normalizedAmount) return { ok: false, errorCode: ERR.INVALID_DATA };
  const eff = dateOrNull(effectiveDate);
  if (!eff) return { ok: false, errorCode: ERR.INVALID_DATA };

  const type = normalizeEventType(eventType, COMPENSATION_EVENT_TYPE.ADJUSTMENT);
  const safeNotes = sanitizeRichTextHtml(notes || '', NOTES_MAX) || '';
  const statusRaw = String(approvalStatus || '').toLowerCase();
  const status = COMPENSATION_APPROVAL_STATUSES.includes(statusRaw)
    ? statusRaw
    : COMPENSATION_APPROVAL_STATUS.APPROVED;

  const r = await db.query(
    `INSERT INTO employee_compensation_events (
       company_id, candidate_id, event_type, amount, effective_date, notes, created_by_user_id,
       approval_status, source_review_id, source_cycle_id
     ) VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               event_type AS "eventType", amount,
               effective_date AS "effectiveDate", notes,
               approval_status AS "approvalStatus",
               source_review_id AS "sourceReviewId",
               source_cycle_id AS "sourceCycleId",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      Number(companyId),
      Number(candidateId),
      type,
      normalizedAmount,
      eff,
      safeNotes,
      createdByUserId || null,
      status,
      sourceReviewId ? Number(sourceReviewId) : null,
      sourceCycleId ? Number(sourceCycleId) : null,
    ]
  );
  return { ok: true, event: mapRow(r.rows[0]) };
}

export async function updateCompensationEvent(dbOrQuery, {
  companyId,
  candidateId,
  eventId,
  eventType,
  amount,
  effectiveDate,
  notes,
}) {
  const db = asDb(dbOrQuery);
  const scoped = await assertInternalPerson(db, { companyId, candidateId });
  if (!scoped.ok) return scoped;
  if (scoped.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const eid = Number(eventId);
  if (!Number.isFinite(eid) || eid <= 0) return { ok: false, errorCode: ERR.INVALID_ID };

  const sets = ['updated_at = NOW()'];
  const params = [Number(companyId), Number(candidateId), eid];
  let n = 4;

  if (eventType !== undefined) {
    sets.push(`event_type = $${n++}`);
    params.push(normalizeEventType(eventType));
  }
  if (amount !== undefined) {
    const normalizedAmount = stripSalary(amount);
    if (!normalizedAmount) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`amount = $${n++}`);
    params.push(normalizedAmount);
  }
  if (effectiveDate !== undefined) {
    const eff = dateOrNull(effectiveDate);
    if (!eff) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`effective_date = $${n++}::date`);
    params.push(eff);
  }
  if (notes !== undefined) {
    sets.push(`notes = $${n++}`);
    params.push(sanitizeRichTextHtml(notes || '', NOTES_MAX) || '');
  }

  if (sets.length === 1) return { ok: false, errorCode: ERR.INVALID_DATA };

  const r = await db.query(
    `UPDATE employee_compensation_events
     SET ${sets.join(', ')}
     WHERE id = $3 AND company_id = $1 AND candidate_id = $2
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               event_type AS "eventType", amount,
               effective_date AS "effectiveDate", notes,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, event: mapRow(r.rows[0]) };
}

export async function deleteCompensationEvent(dbOrQuery, { companyId, candidateId, eventId }) {
  const db = asDb(dbOrQuery);
  const scoped = await assertInternalPerson(db, { companyId, candidateId });
  if (!scoped.ok) return scoped;
  if (scoped.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const eid = Number(eventId);
  if (!Number.isFinite(eid) || eid <= 0) return { ok: false, errorCode: ERR.INVALID_ID };

  const r = await db.query(
    `DELETE FROM employee_compensation_events
     WHERE id = $3 AND company_id = $1 AND candidate_id = $2
     RETURNING id`,
    [Number(companyId), Number(candidateId), eid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, eventId: eid };
}

/** Seed first row from accepted vacancy offer (idempotent if events already exist). */
export async function importCompensationFromOffer(dbOrQuery, {
  companyId,
  candidateId,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const existing = await listCompensationEvents(db, { companyId, candidateId, limit: 1 });
  if (!existing.ok) return existing;
  if ((existing.items || []).length > 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA, reason: 'has_events' };
  }

  const hint = await getAcceptedOfferHint(db, { companyId, candidateId });
  if (!hint?.offerSalary) return { ok: false, errorCode: ERR.NOT_FOUND };

  const eff =
    hint.offerStartDate ||
    new Date().toISOString().slice(0, 10);

  return createCompensationEvent(db, {
    companyId,
    candidateId,
    eventType: COMPENSATION_EVENT_TYPE.HIRE,
    amount: hint.offerSalary,
    effectiveDate: eff,
    notes: '',
    createdByUserId,
  });
}

const ROSTER_PAGE_MAX = 50;
const ROSTER_PAGE_DEFAULT = 20;
const SORT_KEYS = new Set(['name', 'amount', 'effectiveDate', 'eventCount']);

/**
 * Company roster: employees/alumni with current salary (latest event) — paginated.
 * Not payroll. Always scoped by company_id.
 */
export async function listCompanyCompensationRoster(dbOrQuery, {
  companyId,
  q = '',
  employmentStatus = EMPLOYMENT_STATUS.EMPLOYEE,
  hasSalary = 'all',
  marketBand = 'all',
  page = 1,
  pageSize = ROSTER_PAGE_DEFAULT,
  sort = 'name',
  sortDir = 'asc',
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }

  const statuses = [];
  const statusRaw = String(employmentStatus || 'employee').toLowerCase();
  if (statusRaw === 'all') {
    statuses.push(EMPLOYMENT_STATUS.EMPLOYEE, EMPLOYMENT_STATUS.ALUMNI);
  } else if (statusRaw === EMPLOYMENT_STATUS.ALUMNI) {
    statuses.push(EMPLOYMENT_STATUS.ALUMNI);
  } else {
    statuses.push(EMPLOYMENT_STATUS.EMPLOYEE);
  }

  const needle = String(q || '').trim().slice(0, 80);
  const salaryFilter = String(hasSalary || 'all').toLowerCase();
  const bandFilter = String(marketBand || 'all').toLowerCase();
  const pageN = Math.max(1, Number(page) || 1);
  const size = Math.min(ROSTER_PAGE_MAX, Math.max(1, Number(pageSize) || ROSTER_PAGE_DEFAULT));
  const offset = (pageN - 1) * size;
  const dir = String(sortDir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const sortKey = SORT_KEYS.has(String(sort)) ? String(sort) : 'name';

  const params = [cid, statuses];
  let n = 3;
  const where = [
    'c.company_id = $1',
    `c.employment_status = ANY($2::text[])`,
  ];
  if (needle) {
    where.push(`(c.full_name ILIKE $${n} OR COALESCE(c.email, '') ILIKE $${n})`);
    params.push(`%${needle}%`);
    n += 1;
  }

  const salaryJoinFilter =
    salaryFilter === 'with'
      ? 'AND cur.id IS NOT NULL'
      : salaryFilter === 'without'
        ? 'AND cur.id IS NULL'
        : '';

  const amountNum = `(NULLIF(TRIM(cur.amount), ''))::numeric`;
  const minNum = `(NULLIF(TRIM(jr.market_salary_min), ''))::numeric`;
  const maxNum = `(NULLIF(TRIM(jr.market_salary_max), ''))::numeric`;
  let marketBandFilter = '';
  if (bandFilter === 'below') {
    marketBandFilter = `AND ${minNum} IS NOT NULL AND ${amountNum} IS NOT NULL AND ${amountNum} < ${minNum}`;
  } else if (bandFilter === 'above') {
    marketBandFilter = `AND ${maxNum} IS NOT NULL AND ${amountNum} IS NOT NULL AND ${amountNum} > ${maxNum}`;
  } else if (bandFilter === 'in_band') {
    marketBandFilter = `AND ${amountNum} IS NOT NULL
      AND (${minNum} IS NOT NULL OR ${maxNum} IS NOT NULL)
      AND (${minNum} IS NULL OR ${amountNum} >= ${minNum})
      AND (${maxNum} IS NULL OR ${amountNum} <= ${maxNum})`;
  } else if (bandFilter === 'no_band') {
    marketBandFilter = `AND (
      c.job_role_id IS NULL
      OR (
        NULLIF(TRIM(jr.market_salary_min), '') IS NULL
        AND NULLIF(TRIM(jr.market_salary_max), '') IS NULL
      )
    )`;
  }

  let orderBy;
  switch (sortKey) {
    case 'amount':
      orderBy = `ORDER BY ${amountNum} ${dir} NULLS LAST, LOWER(c.full_name) ASC`;
      break;
    case 'effectiveDate':
      orderBy = `ORDER BY cur.effective_date ${dir} NULLS LAST, LOWER(c.full_name) ASC`;
      break;
    case 'eventCount':
      orderBy = `ORDER BY COALESCE(cnt.n, 0) ${dir}, LOWER(c.full_name) ASC`;
      break;
    case 'name':
    default:
      orderBy = `ORDER BY LOWER(c.full_name) ${dir}, c.id ASC`;
      break;
  }

  const fromSql = `
    FROM candidates c
    LEFT JOIN job_roles jr
      ON jr.id = c.job_role_id AND jr.company_id = c.company_id
    LEFT JOIN LATERAL (
      SELECT e.id, e.amount, e.event_type, e.effective_date
      FROM employee_compensation_events e
      WHERE e.company_id = c.company_id AND e.candidate_id = c.id
        AND e.approval_status = 'approved'
      ORDER BY e.effective_date DESC, e.id DESC
      LIMIT 1
    ) cur ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n
      FROM employee_compensation_events e2
      WHERE e2.company_id = c.company_id AND e2.candidate_id = c.id
        AND e2.approval_status = 'approved'
    ) cnt ON TRUE
    WHERE ${where.join(' AND ')}
    ${salaryJoinFilter}
    ${marketBandFilter}
  `;

  const countR = await db.query(
    `SELECT COUNT(*)::int AS total ${fromSql}`,
    params
  );
  const total = countR.rows[0]?.total || 0;

  const listParams = [...params, size, offset];
  const listR = await db.query(
    `SELECT c.id AS "candidateId",
            c.full_name AS "fullName",
            c.email,
            c.employment_status AS "employmentStatus",
            c.job_role_id AS "jobRoleId",
            jr.name AS "jobRoleName",
            jr.market_salary_min AS "marketSalaryMin",
            jr.market_salary_max AS "marketSalaryMax",
            cur.id AS "currentEventId",
            cur.amount AS "currentAmount",
            cur.event_type AS "currentEventType",
            cur.effective_date AS "currentEffectiveDate",
            COALESCE(cnt.n, 0) AS "eventCount"
     ${fromSql}
     ${orderBy}
     LIMIT $${n} OFFSET $${n + 1}`,
    listParams
  );

  const items = (listR.rows || []).map((r) => {
    const compare = compareAmountToMarketBand(
      r.currentAmount,
      r.marketSalaryMin,
      r.marketSalaryMax
    );
    return {
      candidateId: Number(r.candidateId),
      fullName: r.fullName || '',
      email: r.email || null,
      employmentStatus: r.employmentStatus,
      jobRoleId: r.jobRoleId != null ? Number(r.jobRoleId) : null,
      jobRoleName: r.jobRoleName || null,
      marketCompare: compare.status,
      current: r.currentEventId
        ? {
            eventId: Number(r.currentEventId),
            amount: r.currentAmount,
            eventType: r.currentEventType,
            effectiveDate: dateOrNull(r.currentEffectiveDate),
          }
        : null,
      eventCount: Number(r.eventCount) || 0,
    };
  });

  return {
    ok: true,
    items,
    total,
    page: pageN,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * Market band + compare for one person (Equipe Remuneração).
 */
export async function getCompensationMarketContext(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const r = await db.query(
    `SELECT c.job_role_id AS "jobRoleId",
            jr.name AS "jobRoleName",
            jr.market_salary_min AS "marketSalaryMin",
            jr.market_salary_max AS "marketSalaryMax",
            cur.amount AS "currentAmount"
     FROM candidates c
     LEFT JOIN job_roles jr
       ON jr.id = c.job_role_id AND jr.company_id = c.company_id
     LEFT JOIN LATERAL (
       SELECT e.amount
       FROM employee_compensation_events e
       WHERE e.company_id = c.company_id AND e.candidate_id = c.id
         AND e.approval_status = 'approved'
       ORDER BY e.effective_date DESC, e.id DESC
       LIMIT 1
     ) cur ON TRUE
     WHERE c.id = $1 AND c.company_id = $2
     LIMIT 1`,
    [cand, cid]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = r.rows[0];
  const jobRoleId = row.jobRoleId != null ? Number(row.jobRoleId) : null;
  const compare = compareAmountToMarketBand(
    row.currentAmount,
    row.marketSalaryMin,
    row.marketSalaryMax
  );
  return {
    ok: true,
    jobRoleId,
    jobRoleName: row.jobRoleName || null,
    marketSalaryMin: row.marketSalaryMin || null,
    marketSalaryMax: row.marketSalaryMax || null,
    currentAmount: row.currentAmount || null,
    compare,
  };
}

/**
 * Assign (or clear) job role on an employee/alumni for market band compare.
 */
export async function setCandidateJobRole(dbOrQuery, { companyId, candidateId, jobRoleId }) {
  const db = asDb(dbOrQuery);
  const scoped = await assertInternalPerson(db, { companyId, candidateId });
  if (!scoped.ok) return scoped;

  let roleId = null;
  if (jobRoleId != null && jobRoleId !== '') {
    const rid = Number(jobRoleId);
    if (!Number.isFinite(rid) || rid <= 0) {
      return { ok: false, errorCode: ERR.INVALID_ID };
    }
    const role = await db.query(
      `SELECT id FROM job_roles
       WHERE id = $1 AND company_id = $2 AND active = TRUE
       LIMIT 1`,
      [rid, Number(companyId)]
    );
    if (role.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    roleId = rid;
  }

  const occupied=await db.query(`SELECT 1 FROM org_position_assignments a JOIN org_positions p ON p.id=a.position_id AND p.company_id=a.company_id WHERE a.company_id=$1 AND a.candidate_id=$2 AND a.ended_on IS NULL AND p.job_role_id IS DISTINCT FROM $3::bigint`,[companyId,candidateId,roleId]);
  if(occupied.rowCount)return {ok:false,errorCode:ERR.POSITION_IN_USE};
  await db.query(
    `UPDATE candidates
     SET job_role_id = $1
     WHERE id = $2 AND company_id = $3`,
    [roleId, Number(candidateId), Number(companyId)]
  );

  return getCompensationMarketContext(db, { companyId, candidateId });
}

/**
 * Overview: employees whose current pay is below the job role market floor.
 */
export async function getCompensationMarketPulse(dbOrQuery, { companyId, cap = 8 }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { items: [] };
  const lim = Math.min(Math.max(Number(cap) || 8, 1), 20);

  const r = await db.query(
    `SELECT c.id AS "candidateId",
            c.full_name AS "candidateName",
            jr.id AS "jobRoleId",
            jr.name AS "jobRoleName",
            jr.market_salary_min AS "marketSalaryMin",
            jr.market_salary_max AS "marketSalaryMax",
            cur.amount AS "currentAmount"
     FROM candidates c
     JOIN job_roles jr
       ON jr.id = c.job_role_id AND jr.company_id = c.company_id AND jr.active = TRUE
     JOIN LATERAL (
       SELECT e.amount
       FROM employee_compensation_events e
       WHERE e.company_id = c.company_id AND e.candidate_id = c.id
         AND e.approval_status = 'approved'
       ORDER BY e.effective_date DESC, e.id DESC
       LIMIT 1
     ) cur ON TRUE
     WHERE c.company_id = $1
       AND c.employment_status = $2
       AND NULLIF(TRIM(jr.market_salary_min), '') IS NOT NULL
       AND NULLIF(TRIM(cur.amount), '') IS NOT NULL
     ORDER BY c.full_name ASC
     LIMIT 200`,
    [cid, EMPLOYMENT_STATUS.EMPLOYEE]
  );

  const items = [];
  for (const row of r.rows || []) {
    const compare = compareAmountToMarketBand(
      row.currentAmount,
      row.marketSalaryMin,
      row.marketSalaryMax
    );
    if (compare.status !== 'below') continue;
    items.push({
      candidateId: Number(row.candidateId),
      candidateName: row.candidateName,
      jobRoleId: Number(row.jobRoleId),
      jobRoleName: row.jobRoleName,
      currentAmount: row.currentAmount,
      marketSalaryMin: row.marketSalaryMin,
      marketSalaryMax: row.marketSalaryMax,
      compare,
    });
    if (items.length >= lim) break;
  }
  return { items };
}

