/**
 * Sessão live: JWT + estado atual em users (active, role, company, session_version).
 */

import { query } from './db.js';
import { verifyToken } from './auth.js';
import { normalizeEnabledModules } from './company-modules.js';

/**
 * Incrementa session_version e invalida JWTs anteriores.
 * @returns {Promise<number|null>} nova versão ou null se usuário inexistente
 */
export async function bumpSessionVersion(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const r = await query(
    `UPDATE users
     SET session_version = session_version + 1
     WHERE id = $1
     RETURNING session_version AS "sessionVersion"`,
    [id]
  );
  const sv = r.rowCount > 0 ? Number(r.rows[0].sessionVersion) : null;
  if (sv != null) {
    const { setSessionVersionCache } = await import('./session-revocation.js');
    await setSessionVersionCache(id, sv);
  }
  return sv;
}

/**
 * Valida JWT contra DB e anexa capability overrides.
 * Fonte de verdade para role/companyId: linha em users (não o claim cru).
 * @returns {Promise<object|null>}
 */
export async function hydrateSessionPayload(payload) {
  if (!payload?.userId) return null;
  const userId = Number(payload.userId);
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const claimSv = Number(payload.sv);
  if (!Number.isFinite(claimSv) || claimSv < 1) return null;

  const r = await query(
    `SELECT
       u.id,
       u.role,
       u.locale,
       u.active,
       u.deleted AS "userDeleted",
       u.company_id AS "companyId",
       u.session_version AS "sessionVersion",
       c.deleted AS "companyDeleted",
       c.enabled_modules AS "enabledModules",
       (c.signup_creator_user_id IS NOT NULL AND c.signup_creator_user_id = u.id) AS "companyOwner"
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];

  if (!row.active || row.userDeleted) return null;
  if (row.companyId && row.companyDeleted) return null;
  if (Number(row.sessionVersion) !== claimSv) return null;

  const [{ setSessionVersionCache }, { loadUserCapabilityOverrides }] = await Promise.all([
    import('./session-revocation.js'),
    import('./user-capabilities.js'),
  ]);
  const [, overrides] = await Promise.all([
    setSessionVersionCache(userId, Number(row.sessionVersion)),
    loadUserCapabilityOverrides(userId),
  ]);
  const companyModules = row.companyId && !row.companyDeleted
    ? normalizeEnabledModules(row.enabledModules)
    : null;
  const billingRestricted = process.env.STRIPE_BILLING_ENFORCE === 'true' && row.companyId
    ? await (await import('./billing/accounts.js')).companyBillingRestricted(row.companyId)
    : false;
  return {
    userId,
    role: row.role,
    companyId: row.companyId ?? null,
    locale: row.locale || payload.locale || 'pt-BR',
    sv: Number(row.sessionVersion),
    capabilitiesCustomized: overrides.length > 0,
    capabilityOverrides: overrides,
    companyModules,
    billingRestricted: Boolean(billingRestricted),
    companyOwner: Boolean(row.companyOwner) && Boolean(row.companyId) && !row.companyDeleted,
  };
}

/** Cookie → payload hidratado (ou null). */
export async function verifySessionWithCapabilities(token) {
  const payload = token ? verifyToken(token) : null;
  return hydrateSessionPayload(payload);
}
