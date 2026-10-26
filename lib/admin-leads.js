/**
 * Admin early-access / self-service signup leads (cross-tenant).
 */

import { resolveUserOrigin } from './identity/user-signup-origin.js';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const STATUS = new Set(['all', 'pending', 'active', 'inactive']);

/**
 * @param {URLSearchParams | Record<string, string>} searchParams
 */
export function parseLeadsListParams(searchParams) {
  const get = (k, d = '') =>
    typeof searchParams?.get === 'function'
      ? (searchParams.get(k) || d).toString()
      : String(searchParams?.[k] ?? d);

  const pageRaw = parseInt(get('page', '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(get('pageSize', '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  const statusRaw = get('status', 'all').toLowerCase();
  const status = STATUS.has(statusRaw) ? statusRaw : 'all';
  const q = get('q', '').trim().slice(0, 120);
  return { page, pageSize, status, q };
}

function statusSql(status, params) {
  if (status === 'pending') {
    params.push(true);
    return ` AND u.signup_pending = $${params.length}`;
  }
  if (status === 'active') {
    params.push(false, true);
    const a = params.length - 1;
    const b = params.length;
    return ` AND u.signup_pending = $${a} AND u.active = $${b}`;
  }
  if (status === 'inactive') {
    params.push(false, false);
    const a = params.length - 1;
    const b = params.length;
    return ` AND u.signup_pending = $${a} AND u.active = $${b}`;
  }
  return '';
}

/**
 * Lista leads do self-service / early access.
 * @param {{ query: Function }} db
 */
export async function listEarlyAccessLeads(db, opts = {}) {
  const { page, pageSize, status, q } = parseLeadsListParams(opts);
  const params = [];

  let where = `u.deleted = FALSE
    AND (
      u.signup_source IS NOT NULL
      OR u.signup_metadata IS NOT NULL
      OR u.signup_pending = TRUE
    )`;

  where += statusSql(status, params);

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    where += ` AND (
      LOWER(u.email) LIKE $${i}
      OR LOWER(COALESCE(c.name, '')) LIKE $${i}
      OR LOWER(COALESCE(u.signup_metadata->>'fullName', '')) LIKE $${i}
      OR LOWER(COALESCE(u.signup_metadata->>'companyName', '')) LIKE $${i}
    )`;
  }

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id AND c.deleted = FALSE
     WHERE ${where}`,
    params
  );
  const total = cnt.rows[0]?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const offset = (effectivePage - 1) * pageSize;

  params.push(pageSize, offset);
  const lim = params.length - 1;
  const off = params.length;

  const r = await db.query(
    `SELECT
       u.id,
       u.email,
       u.role,
       u.active,
       u.signup_pending AS "signupPending",
       u.signup_source AS "signupSource",
       u.signup_metadata AS "signupMetadata",
       u.onboarding_completed AS "onboardingCompleted",
       u.created_at AS "createdAt",
       u.last_login_at AS "lastLoginAt",
       u.company_id AS "companyId",
       c.name AS "companyName",
       c.signup_auto_created AS "companySignupAutoCreated",
       CASE WHEN c.signup_creator_user_id IS NULL THEN NULL
            ELSE c.signup_creator_user_id = u.id END AS "isCompanySignupCreator",
       (u.password_setup_token IS NOT NULL) AS "passwordSetupPending"
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id AND c.deleted = FALSE
     WHERE ${where}
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $${lim} OFFSET $${off}`,
    params
  );

  const items = r.rows.map((row) => {
    const meta =
      row.signupMetadata && typeof row.signupMetadata === 'object' && !Array.isArray(row.signupMetadata)
        ? row.signupMetadata
        : {};
    let leadStatus = 'inactive';
    if (row.signupPending) leadStatus = 'pending';
    else if (row.active) leadStatus = 'active';

    const origin = resolveUserOrigin({
      signupSource: row.signupSource,
      signupPending: row.signupPending,
      signupMetadata: Object.keys(meta).length ? meta : null,
      companySignupAutoCreated: row.companySignupAutoCreated,
      isCompanySignupCreator: row.isCompanySignupCreator,
    });

    return {
      id: Number(row.id),
      email: row.email,
      role: row.role,
      status: leadStatus,
      origin,
      signupPending: Boolean(row.signupPending),
      active: Boolean(row.active),
      signupSource: row.signupSource || null,
      onboardingCompleted: Boolean(row.onboardingCompleted),
      passwordSetupPending: Boolean(row.passwordSetupPending),
      companyId: row.companyId != null ? Number(row.companyId) : null,
      companyName: row.companyName || meta.companyName || null,
      companySignupAutoCreated: Boolean(row.companySignupAutoCreated),
      fullName: meta.fullName || null,
      jobTitle: meta.jobTitle || null,
      jobTitleOther: meta.jobTitleOther || null,
      teamSize: meta.teamSize || null,
      painPoints: meta.painPoints || null,
      createdAt: row.createdAt || null,
      lastLoginAt: row.lastLoginAt || null,
    };
  });

  return {
    items,
    total,
    page: effectivePage,
    pageSize,
    totalPages,
    status,
    q,
  };
}
