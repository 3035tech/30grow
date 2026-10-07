/**
 * Audit listing; tenant access must supply an authenticated company scope.
 */

import { AUDIT_ACTOR_KIND } from './audit.js';

const PAGE_SIZE_OPTIONS = [20, 30, 50, 100];
const ACTOR_KINDS = new Set(Object.values(AUDIT_ACTOR_KIND));

/**
 * @param {URLSearchParams | Record<string, string>} searchParams
 */
export function parseAuditLogListParams(searchParams) {
  const get = (k, d = '') =>
    typeof searchParams?.get === 'function'
      ? (searchParams.get(k) || d).toString()
      : String(searchParams?.[k] ?? d);

  const pageRaw = parseInt(get('page', '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(get('pageSize', '30'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 30;

  const actorKindRaw = get('actorKind', 'all').toLowerCase();
  const actorKind = ACTOR_KINDS.has(actorKindRaw) ? actorKindRaw : 'all';

  const companyIdRaw = get('companyId', '').trim();
  let companyId = null;
  if (companyIdRaw && companyIdRaw !== 'all') {
    const n = parseInt(companyIdRaw, 10);
    if (Number.isFinite(n) && n > 0) companyId = n;
  }

  const action = get('action', '').trim().slice(0, 120);
  const q = get('q', '').trim().slice(0, 120);

  const targetId = get('targetId', '').trim().slice(0, 128);
  const targetType = get('targetType', '').trim().slice(0, 64);
  return { page, pageSize, actorKind, companyId, action, q, targetId, targetType };
}

/**
 * @param {{ query: Function }} db
 */
export async function listAuditLogEntries(db, opts = {}) {
  const { page, pageSize, actorKind, companyId, action, q, targetId, targetType } = parseAuditLogListParams(opts);
  const params = [];
  let where = '1=1';

  if (actorKind !== 'all') {
    params.push(actorKind);
    where += ` AND a.actor_kind = $${params.length}`;
  }
  if (companyId != null) {
    params.push(companyId);
    where += ` AND a.company_id = $${params.length}`;
  }
  for (const [column, value] of [['target_id', targetId], ['target_type', targetType]]) {
    if (value) { params.push(value); where += ` AND a.${column} = $${params.length}`; }
  }
  if (action) {
    params.push(action);
    where += ` AND a.action = $${params.length}`;
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    where += ` AND (
      LOWER(a.action) LIKE $${i}
      OR LOWER(COALESCE(a.target_type, '')) LIKE $${i}
      OR LOWER(COALESCE(a.target_id, '')) LIKE $${i}
      OR LOWER(COALESCE(a.request_path, '')) LIKE $${i}
      OR LOWER(COALESCE(u.email, '')) LIKE $${i}
      OR LOWER(COALESCE(u.display_name, '')) LIKE $${i}
      OR LOWER(COALESCE(c.email, '')) LIKE $${i}
      OR LOWER(COALESCE(c.full_name, '')) LIKE $${i}
      OR LOWER(COALESCE(co.name, '')) LIKE $${i}
    )`;
  }

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN candidates c ON c.id = a.actor_candidate_id
     LEFT JOIN companies co ON co.id = a.company_id
     WHERE ${where}`,
    params
  );
  const total = cnt.rows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const offset = opts.export === true ? 0 : (safePage - 1) * pageSize;
  const rowLimit = opts.export === true ? 5000 : pageSize;

  params.push(rowLimit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const r = await db.query(
    `SELECT
       a.id,
       a.created_at AS "createdAt",
       a.actor_kind AS "actorKind",
       a.action,
       a.target_type AS "targetType",
       a.target_id AS "targetId",
       a.request_path AS "requestPath",
       a.request_ip AS "requestIp",
       a.metadata,
       a.company_id AS "companyId",
       co.name AS "companyName",
       a.actor_user_id AS "actorUserId",
       u.email AS "actorUserEmail",
       u.display_name AS "actorUserName",
       u.role AS "actorUserRole",
       a.actor_candidate_id AS "actorCandidateId",
       c.email AS "actorCandidateEmail",
       c.full_name AS "actorCandidateName"
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN candidates c ON c.id = a.actor_candidate_id
     LEFT JOIN companies co ON co.id = a.company_id AND co.deleted = FALSE
     WHERE ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return {
    items: r.rows || [],
    total,
    page: safePage,
    pageSize,
    totalPages,
    ...(opts.export === true ? { truncated: total > rowLimit } : {}),
  };
}
