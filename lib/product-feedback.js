/**
 * Product feedback from managers → super-admin support inbox (pilot support, MVP-11).
 * Kinds: bug, question, commercial, idea, ux. First response is promised within
 * SUPPORT_RESPONSE_BUSINESS_DAYS business days (weekends and Brazilian national holidays skipped).
 */

import {
  PRODUCT_FEEDBACK_KIND,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_SEVERITY,
  PRODUCT_FEEDBACK_SEVERITIES,
  PRODUCT_FEEDBACK_STATUS,
  PRODUCT_FEEDBACK_STATUSES,
} from './domain-status.js';
import { ERR } from './api-error-codes.js';
import { COMPANY_MODULES, isCompanyModuleKey, moduleForTab } from './company-modules.js';
import { PRODUCT_LANDING_CONTACT_EMAIL } from './product-landing-seo.js';
import { isNationalHoliday } from './br-holidays.js';

export const SUPPORT_RESPONSE_BUSINESS_DAYS = 1;
export const SUPPORT_CONTACT_EMAIL = PRODUCT_LANDING_CONTACT_EMAIL;

/** Support works on Brazil time (no DST since 2019). */
const SUPPORT_UTC_OFFSET_HOURS = -3;
const SUMMARY_MODULE_LIMIT = 5;
const ASSIGNEE_LIMIT = 50;
const OVERDUE_SCAN_CAP = 500;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const STATUS_FILTER = new Set(['all', 'open', ...PRODUCT_FEEDBACK_STATUSES]);
const KIND_FILTER = new Set(['all', ...PRODUCT_FEEDBACK_KINDS]);
const SEVERITY_FILTER = new Set(['all', ...PRODUCT_FEEDBACK_SEVERITIES]);
const MODULE_FILTER = new Set(['all', ...COMPANY_MODULES]);
const OPEN_STATUSES = [PRODUCT_FEEDBACK_STATUS.NEW, PRODUCT_FEEDBACK_STATUS.REVIEWING];

/** `local` is a Date shifted to support time, read through its UTC fields. */
const isSupportDayOff = (local) =>
  local.getUTCDay() === 0 || local.getUTCDay() === 6 || isNationalHoliday(local.toISOString().slice(0, 10));

/**
 * Adds business days in support time; a request on Friday is due Monday
 * (or Tuesday when Monday is a national holiday).
 * @param {Date|string} from
 * @param {number} days
 */
export function addSupportBusinessDays(from, days = SUPPORT_RESPONSE_BUSINESS_DAYS) {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return null;
  const offsetMs = SUPPORT_UTC_OFFSET_HOURS * 3600 * 1000;
  const local = new Date(start.getTime() + offsetMs);
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    local.setUTCDate(local.getUTCDate() + 1);
    if (!isSupportDayOff(local)) left -= 1;
  }
  // A request made on a day off starts counting on the next business day.
  while (isSupportDayOff(local)) local.setUTCDate(local.getUTCDate() + 1);
  return new Date(local.getTime() - offsetMs);
}

/**
 * SLA view of one item: due date and whether the first response is late.
 * @param {{ createdAt: string|Date, firstResponseAt?: string|Date|null, status: string }} row
 */
export function feedbackResponseSla(row, now = new Date()) {
  const dueAt = addSupportBusinessDays(row.createdAt);
  const answered = Boolean(row.firstResponseAt);
  const open = OPEN_STATUSES.includes(row.status);
  const overdue = Boolean(dueAt) && !answered && open && now.getTime() > dueAt.getTime();
  return { dueAt: dueAt ? dueAt.toISOString() : null, answered, overdue };
}

/**
 * @param {URLSearchParams | Record<string, string>} searchParams
 */
export function parseProductFeedbackListParams(searchParams) {
  const get = (k, d = '') =>
    typeof searchParams?.get === 'function'
      ? (searchParams.get(k) || d).toString()
      : String(searchParams?.[k] ?? d);

  const pageRaw = parseInt(get('page', '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(get('pageSize', '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  const statusRaw = get('status', 'all').toLowerCase();
  const status = STATUS_FILTER.has(statusRaw) ? statusRaw : 'all';
  const kindRaw = get('kind', 'all').toLowerCase();
  const kind = KIND_FILTER.has(kindRaw) ? kindRaw : 'all';
  const severityRaw = get('severity', 'all').toLowerCase();
  const severity = SEVERITY_FILTER.has(severityRaw) ? severityRaw : 'all';
  const moduleRaw = get('module', 'all').toLowerCase();
  const moduleKey = MODULE_FILTER.has(moduleRaw) ? moduleRaw : 'all';
  const overdue = get('overdue', '') === '1';
  const q = get('q', '').trim().slice(0, 120);
  return { page, pageSize, status, kind, severity, module: moduleKey, overdue, q };
}

/**
 * @param {{ query: Function }} db
 * @param {{
 *   companyId: number|null,
 *   userId: number,
 *   kind: string,
 *   message: string,
 *   severity?: string,
 *   activeTab?: string|null,
 *   activeSection?: string|null,
 *   contactOk?: boolean,
 * }} input
 */
export async function createProductFeedback(db, input) {
  const kind = String(input?.kind || '').toLowerCase();
  if (!PRODUCT_FEEDBACK_KINDS.includes(kind)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const severityRaw = String(input?.severity || PRODUCT_FEEDBACK_SEVERITY.MEDIUM).toLowerCase();
  if (!PRODUCT_FEEDBACK_SEVERITIES.includes(severityRaw)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const message = String(input?.message || '').trim();
  if (message.length < 10 || message.length > 4000) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const userId = Number(input?.userId);
  if (!Number.isFinite(userId) || userId < 1) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const companyIdRaw = input?.companyId;
  const companyId =
    companyIdRaw == null || companyIdRaw === ''
      ? null
      : Number(companyIdRaw);
  if (companyId != null && (!Number.isFinite(companyId) || companyId < 1)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const activeTab = String(input?.activeTab || '')
    .trim()
    .slice(0, 80);
  const activeSection = String(input?.activeSection || '')
    .trim()
    .slice(0, 80);
  const contactOk = input?.contactOk !== false;

  const res = await db.query(
    `INSERT INTO product_feedback (
       company_id, user_id, kind, status, message,
       active_tab, active_section, contact_ok, severity, module_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, created_at AS "createdAt"`,
    [
      companyId,
      userId,
      kind,
      PRODUCT_FEEDBACK_STATUS.NEW,
      message,
      activeTab,
      activeSection,
      contactOk,
      severityRaw,
      moduleForTab(activeTab),
    ]
  );
  const row = res.rows[0];
  const dueAt = addSupportBusinessDays(row.createdAt);
  return { ok: true, id: row.id, createdAt: row.createdAt, responseDueAt: dueAt ? dueAt.toISOString() : null };
}

/** Business-day SLA is computed in JS; SQL only narrows to unanswered open items older than one day. */
function buildWhere(opts, params) {
  let where = 'TRUE';
  if (opts.status === 'open') {
    params.push(OPEN_STATUSES);
    where += ` AND f.status = ANY($${params.length}::text[])`;
  } else if (opts.status !== 'all') {
    params.push(opts.status);
    where += ` AND f.status = $${params.length}`;
  }
  if (opts.kind !== 'all') {
    params.push(opts.kind);
    where += ` AND f.kind = $${params.length}`;
  }
  if (opts.severity !== 'all') {
    params.push(opts.severity);
    where += ` AND f.severity = $${params.length}`;
  }
  if (opts.module !== 'all') {
    params.push(opts.module);
    where += ` AND f.module_key = $${params.length}`;
  }
  if (opts.overdue) {
    params.push(OPEN_STATUSES);
    where += ` AND f.first_response_at IS NULL AND f.status = ANY($${params.length}::text[])
               AND f.created_at < NOW() - INTERVAL '1 day'`;
  }
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    const i = params.length;
    where += ` AND (
      LOWER(f.message) LIKE $${i}
      OR LOWER(COALESCE(u.email, '')) LIKE $${i}
      OR LOWER(COALESCE(c.name, '')) LIKE $${i}
      OR LOWER(COALESCE(f.admin_notes, '')) LIKE $${i}
    )`;
  }
  return where;
}

/**
 * Super-admin list (cross-tenant), with SLA, duplicate counts and assignee.
 * @param {{ query: Function }} db
 */
export async function listProductFeedback(db, opts = {}) {
  const parsed = parseProductFeedbackListParams(opts);
  const { page, pageSize } = parsed;
  const params = [];
  const where = buildWhere(parsed, params);

  let total = 0;
  let safePage = page;
  if (parsed.overdue) {
    // Overdue needs the business-day rule; the unanswered queue is small, so page in memory.
    params.push(OVERDUE_SCAN_CAP, 0);
  } else {
    const cnt = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM product_feedback f
       JOIN users u ON u.id = f.user_id AND u.deleted = FALSE
       LEFT JOIN companies c ON c.id = f.company_id AND c.deleted = FALSE
       WHERE ${where}`,
      params
    );
    total = cnt.rows[0]?.n || 0;
    safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    params.push(pageSize, (safePage - 1) * pageSize);
  }
  const lim = params.length - 1;
  const off = params.length;

  const list = await db.query(
    `SELECT
       f.id,
       f.company_id AS "companyId",
       f.user_id AS "userId",
       f.kind,
       f.status,
       f.severity,
       f.module_key AS "moduleKey",
       f.message,
       f.active_tab AS "activeTab",
       f.active_section AS "activeSection",
       f.contact_ok AS "contactOk",
       f.admin_notes AS "adminNotes",
       f.assignee_user_id AS "assigneeUserId",
       a.display_name AS "assigneeName",
       a.email AS "assigneeEmail",
       f.first_response_at AS "firstResponseAt",
       f.duplicate_of_id AS "duplicateOfId",
       f.created_at AS "createdAt",
       f.updated_at AS "updatedAt",
       u.email AS "userEmail",
       u.display_name AS "userName",
       c.name AS "companyName",
       c.slug AS "companySlug"
     FROM product_feedback f
     JOIN users u ON u.id = f.user_id AND u.deleted = FALSE
     LEFT JOIN companies c ON c.id = f.company_id AND c.deleted = FALSE
     LEFT JOIN users a ON a.id = f.assignee_user_id
     WHERE ${where}
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT $${lim} OFFSET $${off}`,
    params
  );

  const now = new Date();
  let rows = list.rows;
  if (parsed.overdue) {
    const late = rows.filter((row) => feedbackResponseSla(row, now).overdue);
    total = late.length;
    safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    rows = late.slice((safePage - 1) * pageSize, safePage * pageSize);
  }

  const ids = rows.map((r) => r.id);
  const dupCounts = new Map();
  if (ids.length) {
    const dup = await db.query(
      `SELECT duplicate_of_id AS id, COUNT(*)::int AS n
       FROM product_feedback
       WHERE duplicate_of_id = ANY($1::bigint[])
       GROUP BY duplicate_of_id`,
      [ids]
    );
    for (const r of dup.rows) dupCounts.set(Number(r.id), r.n);
  }

  const items = rows.map((row) => ({
    ...row,
    duplicateCount: dupCounts.get(Number(row.id)) || 0,
    ...feedbackResponseSla(row, now),
  }));

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Weekly review header: open items by kind, unanswered/overdue and most cited modules.
 * Bounded: aggregates over open items only; module list capped.
 * @param {{ query: Function }} db
 */
export async function summarizeProductFeedback(db, now = new Date()) {
  const [byKind, awaiting, modules] = await Promise.all([
    db.query(
      `SELECT kind, COUNT(*)::int AS n
       FROM product_feedback
       WHERE status = ANY($1::text[]) AND duplicate_of_id IS NULL
       GROUP BY kind`,
      [OPEN_STATUSES]
    ),
    db.query(
      `SELECT created_at AS "createdAt", status
       FROM product_feedback
       WHERE first_response_at IS NULL AND status = ANY($1::text[])
       ORDER BY created_at
       LIMIT $2`,
      [OPEN_STATUSES, OVERDUE_SCAN_CAP]
    ),
    db.query(
      `SELECT module_key AS "moduleKey", COUNT(*)::int AS n
       FROM product_feedback
       WHERE status = ANY($1::text[]) AND module_key IS NOT NULL
       GROUP BY module_key
       ORDER BY n DESC, module_key
       LIMIT $2`,
      [OPEN_STATUSES, SUMMARY_MODULE_LIMIT]
    ),
  ]);
  const openByKind = Object.fromEntries(PRODUCT_FEEDBACK_KINDS.map((k) => [k, 0]));
  for (const r of byKind.rows) openByKind[r.kind] = r.n;
  const overdue = awaiting.rows.filter((r) => feedbackResponseSla(r, now).overdue).length;
  return {
    openByKind,
    open: Object.values(openByKind).reduce((a, b) => a + b, 0),
    awaitingResponse: awaiting.rows.length,
    overdue,
    topModules: modules.rows,
    responseBusinessDays: SUPPORT_RESPONSE_BUSINESS_DAYS,
  };
}

/** Platform super admins that can own a feedback item. */
export async function listFeedbackAssignees(db) {
  const res = await db.query(
    `SELECT id, display_name AS "displayName", email
     FROM users
     WHERE role = 'admin' AND company_id IS NULL AND deleted = FALSE AND active = TRUE
     ORDER BY display_name NULLS LAST, email
     LIMIT $1`,
    [ASSIGNEE_LIMIT]
  );
  return res.rows;
}

/**
 * @param {{ query: Function }} db
 * @param {{
 *   id: number,
 *   status?: string,
 *   adminNotes?: string,
 *   severity?: string,
 *   moduleKey?: string|null,
 *   assigneeUserId?: number|null,
 *   duplicateOfId?: number|null,
 * }} input
 */
export async function updateProductFeedback(db, input) {
  const id = Number(input?.id);
  if (!Number.isFinite(id) || id < 1) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const sets = [];
  const params = [];
  let responded = false;

  if (input.status != null) {
    const status = String(input.status).toLowerCase();
    if (!PRODUCT_FEEDBACK_STATUSES.includes(status)) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
    if (status !== PRODUCT_FEEDBACK_STATUS.NEW) responded = true;
  }

  if (input.adminNotes != null) {
    const notes = String(input.adminNotes).trim().slice(0, 4000);
    params.push(notes);
    sets.push(`admin_notes = $${params.length}`);
    if (notes) responded = true;
  }

  if (input.severity != null) {
    const severity = String(input.severity).toLowerCase();
    if (!PRODUCT_FEEDBACK_SEVERITIES.includes(severity)) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(severity);
    sets.push(`severity = $${params.length}`);
  }

  if (input.moduleKey !== undefined) {
    const moduleKey = input.moduleKey == null || input.moduleKey === '' ? null : String(input.moduleKey);
    if (moduleKey != null && !isCompanyModuleKey(moduleKey)) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(moduleKey);
    sets.push(`module_key = $${params.length}`);
  }

  if (input.assigneeUserId !== undefined) {
    const assignee = input.assigneeUserId == null || input.assigneeUserId === '' ? null : Number(input.assigneeUserId);
    if (assignee != null) {
      const ok = await db.query(
        `SELECT 1 FROM users
         WHERE id = $1 AND role = 'admin' AND company_id IS NULL AND deleted = FALSE AND active = TRUE`,
        [assignee]
      );
      if (!ok.rowCount) return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(assignee);
    sets.push(`assignee_user_id = $${params.length}`);
  }

  if (input.duplicateOfId !== undefined) {
    let target = input.duplicateOfId == null || input.duplicateOfId === '' ? null : Number(input.duplicateOfId);
    if (target != null) {
      if (!Number.isFinite(target) || target < 1 || target === id) {
        return { ok: false, errorCode: ERR.INVALID_DATA };
      }
      // Point at the root so groups stay one level deep.
      const root = await db.query(
        `SELECT COALESCE(duplicate_of_id, id) AS root FROM product_feedback WHERE id = $1`,
        [target]
      );
      if (!root.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
      target = Number(root.rows[0].root);
      if (target === id) return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(target);
    sets.push(`duplicate_of_id = $${params.length}`);
  }

  if (!sets.length) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  if (responded) sets.push('first_response_at = COALESCE(first_response_at, NOW())');
  sets.push('updated_at = NOW()');
  params.push(id);

  const res = await db.query(
    `UPDATE product_feedback
     SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING id, status, severity, module_key AS "moduleKey",
               assignee_user_id AS "assigneeUserId", duplicate_of_id AS "duplicateOfId",
               first_response_at AS "firstResponseAt",
               admin_notes AS "adminNotes", updated_at AS "updatedAt"`,
    params
  );
  if (!res.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, item: res.rows[0] };
}

export { PRODUCT_FEEDBACK_KIND, PRODUCT_FEEDBACK_STATUS, PRODUCT_FEEDBACK_SEVERITY };
