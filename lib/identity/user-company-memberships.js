/**
 * Employer identity memberships during the legacy users.company_id/role window.
 * Writers call syncLegacyUserMembership in the same transaction as the users row.
 */

import { ROLES } from './permissions.js';

const VALID_ROLES = new Set(ROLES);

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function assertDb(db) {
  if (!db || typeof db.query !== 'function') {
    throw new TypeError('A transaction client with query() is required');
  }
}

function assertLegacyMembership({ userId, companyId, role }) {
  const uid = positiveId(userId);
  const cid = companyId == null ? null : positiveId(companyId);
  if (!uid) throw new TypeError('A positive userId is required');
  if (companyId != null && !cid) throw new TypeError('companyId must be positive or null');
  if (!VALID_ROLES.has(role)) throw new TypeError('Invalid manager role');
  return { userId: uid, companyId: cid };
}

/**
 * Mirror the one-company legacy fields without touching unrelated memberships.
 * A legacy company reassignment retires only the previous legacy membership.
 */
export async function syncLegacyUserMembership(
  db,
  {
    userId,
    previousCompanyId = null,
    companyId,
    role,
    active = true,
    deleted = false,
  }
) {
  assertDb(db);
  const normalized = assertLegacyMembership({ userId, companyId, role });
  const previousId = previousCompanyId == null ? null : positiveId(previousCompanyId);
  if (previousCompanyId != null && !previousId) {
    throw new TypeError('previousCompanyId must be positive or null');
  }

  if (previousId && previousId !== normalized.companyId) {
    await db.query(
      `UPDATE user_company_memberships
       SET active = FALSE, deleted = TRUE, updated_at = NOW()
       WHERE user_id = $1 AND company_id = $2`,
      [normalized.userId, previousId]
    );
  }

  if (!normalized.companyId) {
    return { membershipId: null, synced: true };
  }

  const isDeleted = deleted === true;
  const isActive = active === true && !isDeleted;
  const result = await db.query(
    `INSERT INTO user_company_memberships (
       user_id, company_id, role, active, deleted
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, company_id) DO UPDATE
     SET role = EXCLUDED.role,
         active = EXCLUDED.active,
         deleted = EXCLUDED.deleted,
         updated_at = NOW()
     RETURNING id`,
    [normalized.userId, normalized.companyId, role, isActive, isDeleted]
  );

  return { membershipId: result.rows[0]?.id ?? null, synced: true };
}

/** Soft-delete every membership when the global legacy identity is deactivated. */
export async function deactivateUserMemberships(db, userId) {
  assertDb(db);
  const uid = positiveId(userId);
  if (!uid) throw new TypeError('A positive userId is required');

  const result = await db.query(
    `UPDATE user_company_memberships
     SET active = FALSE, deleted = TRUE, updated_at = NOW()
     WHERE user_id = $1 AND (active = TRUE OR deleted = FALSE)`,
    [uid]
  );
  return { updated: result.rowCount ?? 0 };
}

/**
 * Primary-read membership inventory for future authentication/session flows.
 * Inactive rows are opt-in and never authorize access by themselves.
 */
export async function listUserCompanyMemberships(db, userId, { includeInactive = false } = {}) {
  assertDb(db);
  const uid = positiveId(userId);
  if (!uid) throw new TypeError('A positive userId is required');
  const lifecycleSql = includeInactive ? '' : 'AND m.active = TRUE AND m.deleted = FALSE';

  const result = await db.query(
    `SELECT
       m.id,
       m.user_id AS "userId",
       m.company_id AS "companyId",
       m.role,
       m.active,
       m.deleted,
       c.name AS "companyName",
       c.logo_url AS "companyLogoUrl"
     FROM user_company_memberships m
     JOIN companies c ON c.id = m.company_id
     WHERE m.user_id = $1
       ${lifecycleSql}
       AND c.active = TRUE
       AND c.deleted = FALSE
     ORDER BY LOWER(c.name) ASC, m.id ASC`,
    [uid]
  );
  return result.rows;
}
