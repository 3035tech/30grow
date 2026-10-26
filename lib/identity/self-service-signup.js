import { withTransaction } from '../db.js';
import { syncLegacyUserMembership } from './user-company-memberships.js';

export const SELF_SERVICE_COMPANY_ACTION = Object.freeze({
  CREATE: 'created',
  JOIN: 'joined',
});

const ROLE_BY_COMPANY_ACTION = Object.freeze({
  [SELF_SERVICE_COMPANY_ACTION.CREATE]: 'direction',
  [SELF_SERVICE_COMPANY_ACTION.JOIN]: 'hr',
});

/** Atomically creates the pending manager identity and its company membership. */
export async function createSelfServiceSignupIdentity({
  companyId = null,
  companyAction,
  companyName,
  companySlug = null,
  email,
  passwordHash,
  locale = 'pt-BR',
  signupMetadata,
}) {
  const role = ROLE_BY_COMPANY_ACTION[companyAction];
  if (!role) throw new TypeError('Invalid self-service company action');
  const normalizedCompanyId = companyId == null ? null : Number(companyId);
  if (companyAction === SELF_SERVICE_COMPANY_ACTION.JOIN &&
      (!Number.isInteger(normalizedCompanyId) || normalizedCompanyId <= 0)) {
    throw new TypeError('A companyId is required when joining a company');
  }
  if (companyAction === SELF_SERVICE_COMPANY_ACTION.CREATE && !String(companySlug || '').trim()) {
    throw new TypeError('A companySlug is required when creating a company');
  }

  return withTransaction(async (client) => {
    let resolvedCompanyId = normalizedCompanyId;
    if (companyAction === SELF_SERVICE_COMPANY_ACTION.CREATE) {
      const companyRes = await client.query(
        `INSERT INTO companies (name, slug, active, signup_auto_created)
         VALUES ($1, $2, TRUE, TRUE)
         RETURNING id`,
        [String(companyName).trim(), String(companySlug).trim()]
      );
      resolvedCompanyId = companyRes.rows[0].id;
    }

    const userRes = await client.query(
      `INSERT INTO users (
        company_id, email, password_hash, role, locale,
        active, signup_pending, signup_source, signup_metadata, deleted
      ) VALUES ($1, $2, $3, $4, $5, FALSE, TRUE, 'early_access', $6, FALSE)
      RETURNING id, company_id AS "companyId", role, active, deleted`,
      [
        resolvedCompanyId,
        String(email).trim().toLowerCase(),
        passwordHash,
        role,
        locale || 'pt-BR',
        JSON.stringify(signupMetadata),
      ]
    );
    const user = userRes.rows[0];
    await syncLegacyUserMembership(client, {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      active: user.active,
      deleted: user.deleted,
    });

    if (companyAction === SELF_SERVICE_COMPANY_ACTION.CREATE) {
      await client.query(
        `UPDATE companies SET signup_creator_user_id = $1 WHERE id = $2`,
        [user.id, resolvedCompanyId]
      );
    }

    return { userId: user.id, companyId: resolvedCompanyId, role: user.role };
  });
}
