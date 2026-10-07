/**
 * Field team (migration 154): visits planned per day (route of the day), check-in with
 * device location and optional photo, and reimbursement requests with receipt + approval.
 * Gated by the DP module and active employee status (same rule as the time clock module).
 */

import crypto from 'node:crypto';
import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import {
  FIELD_EXPENSE_CATEGORIES,
  FIELD_EXPENSE_STATUS,
  FIELD_EXPENSE_STATUSES,
  FIELD_VISIT_STATUS,
  TIME_REQUEST_DECISION,
} from '../domain-status.js';
import {
  companyScopedObjectKey,
  deleteObjectBestEffort,
  getObjectBytes,
  isObjectStorageConfigured,
  putObject,
} from '../s3-object-storage.js';
import { parsePunchCoordinates } from '../time-clock-format.js';
import { assertValidDpDocumentFile } from './employee-dp.js';
import { DEFAULT_SCHEDULE, getCompanyTimeSchedule, getTimeClockAccess, isoDayInTz } from './time-clock.js';

export const FIELD_DAY_VISITS_CAP = 50;
export const FIELD_EMPLOYEE_EXPENSES_CAP = 30;
export const FIELD_LIST_PAGE_SIZE = 20;
export const FIELD_EXPENSE_MAX_CENTS = 10_000_000;
export const FIELD_TEXT = Object.freeze({ TITLE: 200, ADDRESS: 300, NOTES: 1000, DESCRIPTION: 500, DECISION: 500 });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PG_UNIQUE_VIOLATION = '23505';
const fail = (errorCode) => ({ ok: false, errorCode });
const clip = (s, max) => String(s ?? '').trim().slice(0, max);
const validIds = (...ids) => ids.every((n) => Number.isSafeInteger(n) && n > 0);

const VISIT_COLUMNS = `v.id, v.candidate_id AS "candidateId", to_char(v.visit_date, 'YYYY-MM-DD') AS "day",
  to_char(v.planned_time, 'HH24:MI') AS "plannedTime", v.title, v.address, v.notes, v.status,
  v.checkin_at AS "checkinAt", v.checkin_latitude AS "latitude", v.checkin_longitude AS "longitude",
  v.checkin_accuracy_m AS "accuracy", v.checkout_at AS "checkoutAt", v.outcome_note AS "outcomeNote",
  (v.photo_file_key IS NOT NULL) AS "hasPhoto", v.created_at AS "createdAt"`;

const EXPENSE_COLUMNS = `e.id, e.candidate_id AS "candidateId", e.visit_id AS "visitId",
  to_char(e.expense_date, 'YYYY-MM-DD') AS "day", e.category, e.amount_cents AS "amountCents", e.currency,
  e.description, e.status, (e.receipt_file_key IS NOT NULL) AS "hasReceipt", e.receipt_file_name AS "receiptName",
  e.decided_at AS "decidedAt", e.decision_note AS "decisionNote", e.created_at AS "createdAt"`;

function mapVisit(row) {
  if (!row) return null;
  const num = (v) => (v == null ? null : Number(v));
  return {
    ...row,
    id: Number(row.id),
    candidateId: Number(row.candidateId),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    accuracy: num(row.accuracy),
  };
}

function mapExpense(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    candidateId: Number(row.candidateId),
    visitId: row.visitId != null ? Number(row.visitId) : null,
    amountCents: Number(row.amountCents),
  };
}

async function companyToday(db, companyId) {
  const s = await getCompanyTimeSchedule(db, { companyId });
  return isoDayInTz(new Date(), s.schedule?.timezone || DEFAULT_SCHEDULE.timezone);
}

/** `{ ok, enabled }` — DP module on and the person is an active employee of the company. */
export async function getFieldAccess(dbOrQuery, { companyId, candidateId }) {
  const access = await getTimeClockAccess(dbOrQuery, { companyId, candidateId });
  if (!access.ok) return access;
  return { ok: true, enabled: Boolean(access.moduleEnabled) };
}

async function requireFieldAccess(db, companyId, candidateId) {
  const access = await getFieldAccess(db, { companyId, candidateId });
  if (!access.ok) return access;
  return access.enabled ? { ok: true } : fail(ERR.FORBIDDEN);
}

/** Collaborator view: visits of the day (company timezone by default) + recent own expenses. */
export async function getEmployeeFieldDay(dbOrQuery, { companyId, candidateId, day = '' }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!validIds(cid, cand)) return fail(ERR.INVALID_ID);
  const gate = await requireFieldAccess(db, cid, cand);
  if (!gate.ok) return gate;
  const today = await companyToday(db, cid);
  const dayIso = ISO_DAY.test(String(day || '')) ? String(day) : today;
  const [visits, expenses] = await Promise.all([
    db.query(
      `SELECT ${VISIT_COLUMNS} FROM field_visits v
       WHERE v.company_id = $1 AND v.candidate_id = $2 AND v.visit_date = $3::date
       ORDER BY v.planned_time NULLS LAST, v.id
       LIMIT ${FIELD_DAY_VISITS_CAP}`,
      [cid, cand, dayIso]
    ),
    db.query(
      `SELECT ${EXPENSE_COLUMNS} FROM field_expenses e
       WHERE e.company_id = $1 AND e.candidate_id = $2
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ${FIELD_EMPLOYEE_EXPENSES_CAP}`,
      [cid, cand]
    ),
  ]);
  return {
    ok: true,
    day: dayIso,
    today,
    visits: visits.rows.map(mapVisit),
    expenses: expenses.rows.map(mapExpense),
  };
}

/** Manager plans a visit or the collaborator logs an unplanned one (createdByUserId = null). */
export async function createFieldVisit(dbOrQuery, { companyId, candidateId, day, plannedTime = '', title, address = '', notes = '', createdByUserId = null }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!validIds(cid, cand)) return fail(ERR.INVALID_ID);
  const name = clip(title, FIELD_TEXT.TITLE);
  if (!name || !ISO_DAY.test(String(day || ''))) return fail(ERR.INVALID_DATA);
  const hm = String(plannedTime || '').trim();
  if (hm && !HM.test(hm)) return fail(ERR.INVALID_DATA);
  const gate = await requireFieldAccess(db, cid, cand);
  if (!gate.ok) return gate;
  const r = await db.query(
    `INSERT INTO field_visits (company_id, candidate_id, visit_date, planned_time, title, address, notes, created_by_user_id)
     VALUES ($1, $2, $3::date, $4::time, $5, $6, $7, $8)
     RETURNING id`,
    [cid, cand, day, hm || null, name, clip(address, FIELD_TEXT.ADDRESS), clip(notes, FIELD_TEXT.NOTES), createdByUserId]
  );
  return { ok: true, item: await loadVisit(db, cid, Number(r.rows[0].id)) };
}

async function loadVisit(db, companyId, id) {
  const r = await db.query(
    `SELECT ${VISIT_COLUMNS} FROM field_visits v WHERE v.id = $1 AND v.company_id = $2`,
    [id, companyId]
  );
  return mapVisit(r.rows[0]);
}

/**
 * Check-in (planned → checked_in) with a fresh device position, or complete
 * (checked_in → done) with an optional outcome note. A repeated check-in is a no-op.
 */
export async function updateEmployeeFieldVisit(dbOrQuery, { companyId, candidateId, id, action, latitude, longitude, accuracy = null, note = '' }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const vid = Number(id);
  if (!validIds(cid, cand, vid)) return fail(ERR.INVALID_ID);
  const gate = await requireFieldAccess(db, cid, cand);
  if (!gate.ok) return gate;

  if (action === 'check_in') {
    const coords = parsePunchCoordinates(latitude, longitude);
    if (!coords) return fail(ERR.GEOLOCATION_REQUIRED);
    const acc = Number(accuracy);
    const r = await db.query(
      `UPDATE field_visits SET status = '${FIELD_VISIT_STATUS.CHECKED_IN}', checkin_at = NOW(),
         checkin_latitude = $4, checkin_longitude = $5, checkin_accuracy_m = $6, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND candidate_id = $3 AND status = '${FIELD_VISIT_STATUS.PLANNED}'
       RETURNING id`,
      [vid, cid, cand, coords.latitude.toFixed(6), coords.longitude.toFixed(6),
        Number.isFinite(acc) && acc >= 0 ? Math.min(100000, Math.round(acc)) : null]
    );
    if (r.rowCount) return { ok: true, item: await loadVisit(db, cid, vid) };
    const cur = await loadOwnVisit(db, cid, cand, vid);
    if (!cur) return fail(ERR.NOT_FOUND);
    if (cur.status === FIELD_VISIT_STATUS.CHECKED_IN) return { ok: true, item: cur, replayed: true };
    return fail(ERR.FIELD_VISIT_NOT_OPEN);
  }

  if (action === 'complete') {
    const r = await db.query(
      `UPDATE field_visits SET status = '${FIELD_VISIT_STATUS.DONE}', checkout_at = NOW(), outcome_note = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND candidate_id = $3 AND status = '${FIELD_VISIT_STATUS.CHECKED_IN}'
       RETURNING id`,
      [vid, cid, cand, clip(note, FIELD_TEXT.NOTES)]
    );
    if (r.rowCount) return { ok: true, item: await loadVisit(db, cid, vid) };
    const cur = await loadOwnVisit(db, cid, cand, vid);
    return fail(cur ? ERR.FIELD_VISIT_NOT_OPEN : ERR.NOT_FOUND);
  }

  return fail(ERR.INVALID_DATA);
}

async function loadOwnVisit(db, companyId, candidateId, id) {
  const r = await db.query(
    `SELECT ${VISIT_COLUMNS} FROM field_visits v WHERE v.id = $1 AND v.company_id = $2 AND v.candidate_id = $3`,
    [id, companyId, candidateId]
  );
  return mapVisit(r.rows[0]);
}

/** Manager cancels a visit that has not started. */
export async function cancelFieldVisit(dbOrQuery, { companyId, id }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const vid = Number(id);
  if (!validIds(cid, vid)) return fail(ERR.INVALID_ID);
  const r = await db.query(
    `UPDATE field_visits SET status = '${FIELD_VISIT_STATUS.CANCELLED}', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = '${FIELD_VISIT_STATUS.PLANNED}'
     RETURNING id, candidate_id AS "candidateId"`,
    [vid, cid]
  );
  if (r.rowCount) return { ok: true, id: vid, candidateId: Number(r.rows[0].candidateId) };
  const exists = await db.query('SELECT 1 FROM field_visits WHERE id = $1 AND company_id = $2', [vid, cid]);
  return fail(exists.rowCount ? ERR.FIELD_VISIT_NOT_OPEN : ERR.NOT_FOUND);
}

/** Manager day view across the team (bounded page, newest plan order). */
export async function listCompanyFieldVisits(dbOrQuery, { companyId, day, candidateId = null, page = 1, pageSize = FIELD_LIST_PAGE_SIZE }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!validIds(cid)) return fail(ERR.COMPANY_REQUIRED);
  const dayIso = ISO_DAY.test(String(day || '')) ? String(day) : await companyToday(db, cid);
  const size = Math.min(50, Math.max(5, Number(pageSize) || FIELD_LIST_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid, dayIso];
  let where = 'v.company_id = $1 AND v.visit_date = $2::date';
  if (candidateId != null && validIds(Number(candidateId))) {
    params.push(Number(candidateId));
    where += ` AND v.candidate_id = $${params.length}`;
  }
  const from = `FROM field_visits v JOIN candidates c ON c.id = v.candidate_id AND c.company_id = v.company_id WHERE ${where}`;
  const countRes = await db.query(`SELECT COUNT(*)::int AS n ${from}`, params);
  params.push(size, (pg - 1) * size);
  const r = await db.query(
    `SELECT ${VISIT_COLUMNS}, c.full_name AS "candidateName"
     ${from}
     ORDER BY c.full_name, v.planned_time NULLS LAST, v.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    ok: true,
    day: dayIso,
    page: pg,
    pageSize: size,
    total: Number(countRes.rows[0]?.n) || 0,
    items: r.rows.map((row) => ({ ...mapVisit(row), candidateName: row.candidateName })),
  };
}

function visitPhotoPrefix(companyId, candidateId, id) {
  return companyScopedObjectKey(companyId, `field-visits/${candidateId}/${id}`);
}

function expenseReceiptPrefix(companyId, candidateId, id) {
  return companyScopedObjectKey(companyId, `field-expenses/${candidateId}/${id}`);
}

function fileExt(mimeType) {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'pdf';
}

/** Stores the object, swaps the key in one guarded UPDATE and removes the previous object. */
async function replaceStoredFile(db, { prefix, file, imagesOnly = false, update }) {
  if (!isObjectStorageConfigured()) return fail(ERR.STORAGE_NOT_CONFIGURED);
  const { mimeType } = assertValidDpDocumentFile(file);
  if (imagesOnly && mimeType === 'application/pdf') {
    const err = new Error(ERR.INVALID_CV_FILE_TYPE);
    err.code = ERR.INVALID_CV_FILE_TYPE;
    throw err;
  }
  const ext = fileExt(mimeType);
  const objectKey = `${prefix}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const put = await putObject({ key: objectKey, body: file.buffer, contentType: mimeType, cacheControl: 'private, no-store' });
  if (!put?.url) return fail(ERR.STORAGE_UPLOAD_FAILED);
  const r = await update(db, objectKey, clip(file.originalName || `file.${ext}`, 200));
  if (!r.rowCount) {
    await deleteObjectBestEffort(objectKey);
    return null;
  }
  const prev = r.rows[0].prevKey;
  if (prev && prev !== objectKey && String(prev).startsWith(`${prefix}/`)) await deleteObjectBestEffort(prev);
  return { ok: true };
}

/** Optional photo of a started or finished own visit (jpeg/png). */
export async function uploadFieldVisitPhoto({ companyId, candidateId, id, file }) {
  const db = asDb(null);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const vid = Number(id);
  if (!validIds(cid, cand, vid)) return fail(ERR.INVALID_ID);
  const gate = await requireFieldAccess(db, cid, cand);
  if (!gate.ok) return gate;
  const done = await replaceStoredFile(db, {
    prefix: visitPhotoPrefix(cid, cand, vid),
    file,
    imagesOnly: true,
    update: (q, key, name) => q.query(
      `UPDATE field_visits t SET photo_file_key = $4, photo_file_name = $5, updated_at = NOW()
       FROM (SELECT id, photo_file_key FROM field_visits
             WHERE id = $1 AND company_id = $2 AND candidate_id = $3
               AND status IN ('${FIELD_VISIT_STATUS.CHECKED_IN}', '${FIELD_VISIT_STATUS.DONE}') FOR UPDATE) prev
       WHERE t.id = prev.id
       RETURNING prev.photo_file_key AS "prevKey"`,
      [vid, cid, cand, key, name]
    ),
  });
  if (done) return done.ok ? { ok: true, id: vid, hasPhoto: true } : done;
  const cur = await loadOwnVisit(db, cid, cand, vid);
  return fail(cur ? ERR.FIELD_VISIT_NOT_OPEN : ERR.NOT_FOUND);
}

/** candidateId restricts to the collaborator's own record; omit for HR (company scope). */
export async function downloadFieldVisitPhoto({ companyId, id, candidateId = null }) {
  return downloadStoredFile({
    table: 'field_visits', keyCol: 'photo_file_key', nameCol: 'photo_file_name',
    prefixOf: visitPhotoPrefix, companyId, id, candidateId,
  });
}

export async function downloadFieldExpenseReceipt({ companyId, id, candidateId = null }) {
  return downloadStoredFile({
    table: 'field_expenses', keyCol: 'receipt_file_key', nameCol: 'receipt_file_name',
    prefixOf: expenseReceiptPrefix, companyId, id, candidateId,
  });
}

async function downloadStoredFile({ table, keyCol, nameCol, prefixOf, companyId, id, candidateId }) {
  const cid = Number(companyId);
  const rid = Number(id);
  if (!validIds(cid, rid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const params = [rid, cid];
  let where = 'id = $1 AND company_id = $2';
  if (candidateId != null) {
    params.push(Number(candidateId));
    where += ' AND candidate_id = $3';
  }
  const r = await db.query(
    `SELECT candidate_id AS "candidateId", ${keyCol} AS "fileKey", ${nameCol} AS "fileName"
     FROM ${table} WHERE ${where} LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row?.fileKey) return fail(ERR.NOT_FOUND);
  if (!String(row.fileKey).startsWith(`${prefixOf(cid, row.candidateId, rid)}/`)) return fail(ERR.NOT_FOUND);
  const object = await getObjectBytes(row.fileKey);
  return { ok: true, body: object.body, contentType: object.contentType, fileName: clip(row.fileName || 'file', 200) };
}

/**
 * Collaborator submits a reimbursement (pending). `idempotencyKey` makes app retries
 * return the first request untouched.
 */
export async function createFieldExpense(dbOrQuery, { companyId, candidateId, day, category, amountCents, description, visitId = null, idempotencyKey = null }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!validIds(cid, cand)) return fail(ERR.INVALID_ID);
  const cents = Number(amountCents);
  const text = clip(description, FIELD_TEXT.DESCRIPTION);
  if (!ISO_DAY.test(String(day || '')) || !FIELD_EXPENSE_CATEGORIES.includes(category)
    || !Number.isSafeInteger(cents) || cents <= 0 || cents > FIELD_EXPENSE_MAX_CENTS || text.length < 3) {
    return fail(ERR.INVALID_DATA);
  }
  const gate = await requireFieldAccess(db, cid, cand);
  if (!gate.ok) return gate;
  if (day > await companyToday(db, cid)) return fail(ERR.INVALID_DATA);

  if (idempotencyKey) {
    const prev = await db.query(
      `SELECT ${EXPENSE_COLUMNS} FROM field_expenses e
       WHERE e.company_id = $1 AND e.candidate_id = $2 AND e.idempotency_key = $3`,
      [cid, cand, idempotencyKey]
    );
    if (prev.rowCount) return { ok: true, item: mapExpense(prev.rows[0]), replayed: true };
  }

  let visit = null;
  if (visitId != null) {
    const vid = Number(visitId);
    if (!validIds(vid)) return fail(ERR.INVALID_ID);
    visit = await loadOwnVisit(db, cid, cand, vid);
    if (!visit) return fail(ERR.NOT_FOUND);
  }

  try {
    const r = await db.query(
      `INSERT INTO field_expenses (company_id, candidate_id, visit_id, expense_date, category, amount_cents, description, idempotency_key)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
       RETURNING id`,
      [cid, cand, visit?.id || null, day, category, cents, text, idempotencyKey || null]
    );
    return { ok: true, item: await loadExpense(db, cid, Number(r.rows[0].id)) };
  } catch (e) {
    if (e?.code === PG_UNIQUE_VIOLATION && idempotencyKey) {
      const again = await db.query(
        `SELECT ${EXPENSE_COLUMNS} FROM field_expenses e
         WHERE e.company_id = $1 AND e.candidate_id = $2 AND e.idempotency_key = $3`,
        [cid, cand, idempotencyKey]
      );
      if (again.rowCount) return { ok: true, item: mapExpense(again.rows[0]), replayed: true };
    }
    throw e;
  }
}

async function loadExpense(db, companyId, id) {
  const r = await db.query(
    `SELECT ${EXPENSE_COLUMNS}, c.full_name AS "candidateName"
     FROM field_expenses e JOIN candidates c ON c.id = e.candidate_id AND c.company_id = e.company_id
     WHERE e.id = $1 AND e.company_id = $2`,
    [id, companyId]
  );
  const row = r.rows[0];
  return row ? { ...mapExpense(row), candidateName: row.candidateName } : null;
}

/** Collaborator withdraws an own pending request; the receipt leaves storage too. */
export async function cancelFieldExpense({ companyId, candidateId, id }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const eid = Number(id);
  if (!validIds(cid, cand, eid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const r = await db.query(
    `UPDATE field_expenses t SET status = '${FIELD_EXPENSE_STATUS.CANCELLED}', receipt_file_key = NULL, receipt_file_name = '', updated_at = NOW()
     FROM (SELECT id, receipt_file_key FROM field_expenses
           WHERE id = $1 AND company_id = $2 AND candidate_id = $3
             AND status = '${FIELD_EXPENSE_STATUS.PENDING}' FOR UPDATE) prev
     WHERE t.id = prev.id
     RETURNING prev.receipt_file_key AS "fileKey"`,
    [eid, cid, cand]
  );
  if (!r.rowCount) {
    const exists = await db.query(
      'SELECT 1 FROM field_expenses WHERE id = $1 AND company_id = $2 AND candidate_id = $3',
      [eid, cid, cand]
    );
    return fail(exists.rowCount ? ERR.FIELD_EXPENSE_NOT_PENDING : ERR.NOT_FOUND);
  }
  const key = r.rows[0].fileKey;
  if (key && String(key).startsWith(`${expenseReceiptPrefix(cid, cand, eid)}/`)) await deleteObjectBestEffort(key);
  return { ok: true, id: eid };
}

/** Receipt for an own pending reimbursement (pdf/jpeg/png; replaces a previous file). */
export async function uploadFieldExpenseReceipt({ companyId, candidateId, id, file }) {
  const db = asDb(null);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const eid = Number(id);
  if (!validIds(cid, cand, eid)) return fail(ERR.INVALID_ID);
  const done = await replaceStoredFile(db, {
    prefix: expenseReceiptPrefix(cid, cand, eid),
    file,
    update: (q, key, name) => q.query(
      `UPDATE field_expenses t SET receipt_file_key = $4, receipt_file_name = $5, updated_at = NOW()
       FROM (SELECT id, receipt_file_key FROM field_expenses
             WHERE id = $1 AND company_id = $2 AND candidate_id = $3
               AND status = '${FIELD_EXPENSE_STATUS.PENDING}' FOR UPDATE) prev
       WHERE t.id = prev.id
       RETURNING prev.receipt_file_key AS "prevKey"`,
      [eid, cid, cand, key, name]
    ),
  });
  if (done) return done.ok ? { ok: true, id: eid, hasReceipt: true } : done;
  const exists = await db.query(
    'SELECT 1 FROM field_expenses WHERE id = $1 AND company_id = $2 AND candidate_id = $3',
    [eid, cid, cand]
  );
  return fail(exists.rowCount ? ERR.FIELD_EXPENSE_NOT_PENDING : ERR.NOT_FOUND);
}

/** Manager queue (bounded page) + approved/pending totals for the same filter. */
export async function listFieldExpenses(dbOrQuery, { companyId, status = FIELD_EXPENSE_STATUS.PENDING, q = '', page = 1, pageSize = FIELD_LIST_PAGE_SIZE }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!validIds(cid)) return fail(ERR.COMPANY_REQUIRED);
  const size = Math.min(50, Math.max(5, Number(pageSize) || FIELD_LIST_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid];
  let where = 'e.company_id = $1';
  if (status && FIELD_EXPENSE_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND e.status = $${params.length}`;
  }
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(c.full_name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length})`;
  }
  const from = `FROM field_expenses e JOIN candidates c ON c.id = e.candidate_id AND c.company_id = e.company_id WHERE ${where}`;
  const head = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(e.amount_cents), 0)::bigint AS "sumCents" ${from}`,
    params
  );
  params.push(size, (pg - 1) * size);
  const r = await db.query(
    `SELECT ${EXPENSE_COLUMNS}, c.full_name AS "candidateName", v.title AS "visitTitle"
     ${from.replace('WHERE', 'LEFT JOIN field_visits v ON v.id = e.visit_id AND v.company_id = e.company_id WHERE')}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    ok: true,
    page: pg,
    pageSize: size,
    total: Number(head.rows[0]?.n) || 0,
    sumCents: Number(head.rows[0]?.sumCents) || 0,
    items: r.rows.map((row) => ({ ...mapExpense(row), candidateName: row.candidateName, visitTitle: row.visitTitle || '' })),
  };
}

export async function countPendingFieldExpenses(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM field_expenses WHERE company_id = $1 AND status = '${FIELD_EXPENSE_STATUS.PENDING}'`,
      [Number(companyId)]
    );
    return Number(r.rows[0]?.n) || 0;
  } catch (e) {
    if (e?.code === '42P01') return 0;
    throw e;
  }
}

/** Approve or reject a pending reimbursement (single guarded UPDATE, no lost update). */
export async function decideFieldExpense(dbOrQuery, { companyId, id, decision, note = '', userId = null }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const eid = Number(id);
  if (!validIds(cid, eid)) return fail(ERR.INVALID_ID);
  if (!Object.values(TIME_REQUEST_DECISION).includes(decision)) return fail(ERR.INVALID_DATA);
  const status = decision === TIME_REQUEST_DECISION.APPROVE ? FIELD_EXPENSE_STATUS.APPROVED : FIELD_EXPENSE_STATUS.REJECTED;
  const r = await db.query(
    `UPDATE field_expenses SET status = $3, decided_by_user_id = $4, decided_at = NOW(), decision_note = $5, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = '${FIELD_EXPENSE_STATUS.PENDING}'
     RETURNING id, candidate_id AS "candidateId", amount_cents AS "amountCents", category,
       to_char(expense_date, 'YYYY-MM-DD') AS "day"`,
    [eid, cid, status, userId, clip(note, FIELD_TEXT.DECISION)]
  );
  if (!r.rowCount) {
    const exists = await db.query('SELECT 1 FROM field_expenses WHERE id = $1 AND company_id = $2', [eid, cid]);
    return fail(exists.rowCount ? ERR.FIELD_EXPENSE_NOT_PENDING : ERR.NOT_FOUND);
  }
  const row = r.rows[0];
  return {
    ok: true,
    id: eid,
    status,
    candidateId: Number(row.candidateId),
    amountCents: Number(row.amountCents),
    category: row.category,
    day: row.day,
  };
}
