/**
 * DB load/save for user_capability_overrides (etapa 3).
 * Public assessment links are unaffected — see lib/permissions.js invariant.
 */

import { pool, query } from './db.js';
import {
  ASSIGNABLE_MODULE_CAPS,
  CAP,
  defaultAssignableModulesForRole,
  modulesMatchRoleDefaults,
} from './permissions.js';

/** Verify JWT + live user row + capability overrides (lib/session.js). */
export { verifySessionWithCapabilities } from './session.js';

/**
 * @param {number|string} userId
 * @returns {Promise<Array<{ capability: string, granted: boolean }>>}
 */
export async function loadUserCapabilityOverrides(userId) {
  if (userId == null || userId === '') return [];
  // Primary: authz must not lag behind admin revoke/grant.
  const r = await query(
    `SELECT capability, granted
     FROM user_capability_overrides
     WHERE user_id = $1
     ORDER BY capability`,
    [userId]
  );
  return r.rows.map((row) => ({
    capability: String(row.capability),
    granted: row.granted !== false,
  }));
}

/**
 * Hidrata sessão (active/deleted/sv/role/company) + overrides.
 * Preferir verifySessionWithCapabilities(token) nos call sites novos.
 * @param {object | null | undefined} payload
 */
export async function attachCapabilityOverrides(payload) {
  const { hydrateSessionPayload } = await import('./session.js');
  return hydrateSessionPayload(payload);
}

/**
 * Replace module whitelist for a user.
 * null/undefined modules ⇒ clear overrides (role defaults).
 * Custom list (including empty) ⇒ store rows; always persist profile.self so
 * customized=true even when no assignable modules (profile-only lock-down).
 *
 * @param {number} userId
 * @param {string} role
 * @param {string[] | null | undefined} modules
 */
export async function replaceUserModuleCapabilities(userId, role, modules, opts = {}) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) throw new Error('INVALID_USER');

  if (modules == null) {
    await query(`DELETE FROM user_capability_overrides WHERE user_id = $1`, [uid]);
    return { customized: false, modules: defaultAssignableModulesForRole(role) };
  }

  const allowed = new Set(ASSIGNABLE_MODULE_CAPS);
  let companyCapAllow = null;
  const companyId = Number(opts.companyId);
  if (Number.isFinite(companyId) && companyId > 0) {
    const { getCompanyEnabledModules } = await import('./company-module-entitlements.js');
    const { capsForCompanyModules } = await import('./company-modules.js');
    companyCapAllow = capsForCompanyModules(await getCompanyEnabledModules(null, companyId));
  }

  const selected = [];
  for (const raw of modules) {
    const c = String(raw || '').trim();
    if (!c || !allowed.has(c)) continue;
    if (c === CAP.VACANCIES_MANAGE) continue;
    if (companyCapAllow && !companyCapAllow.has(c)) continue;
    if (!selected.includes(c)) selected.push(c);
  }

  if (modulesMatchRoleDefaults(role, selected)) {
    await query(`DELETE FROM user_capability_overrides WHERE user_id = $1`, [uid]);
    return { customized: false, modules: defaultAssignableModulesForRole(role) };
  }

  // Marker: profile.self always stored when customized (even if selected is []).
  const toStore = [CAP.PROFILE_SELF, ...selected.filter((c) => c !== CAP.PROFILE_SELF)];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM user_capability_overrides WHERE user_id = $1`, [uid]);
    await client.query(
      `INSERT INTO user_capability_overrides (user_id, capability, granted)
       SELECT $1, cap, TRUE
       FROM unnest($2::text[]) AS cap
       ON CONFLICT (user_id, capability) DO UPDATE SET granted = EXCLUDED.granted`,
      [uid, toStore]
    );
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  return { customized: true, modules: selected };
}

/**
 * Effective assignable modules for admin UI (checkboxes).
 */
export function effectiveAssignableModules(payloadOrRole, overridesState) {
  const role = typeof payloadOrRole === 'string' ? payloadOrRole : payloadOrRole?.role;
  const customized =
    typeof payloadOrRole === 'object' && payloadOrRole?.capabilitiesCustomized === true
      ? true
      : Boolean(overridesState?.customized);
  const overrides =
    (typeof payloadOrRole === 'object' && payloadOrRole?.capabilityOverrides) ||
    overridesState?.overrides ||
    [];

  if (!customized) return defaultAssignableModulesForRole(role);

  const set = new Set();
  for (const o of overrides) {
    if (o.granted === false) continue;
    const c = o.capability;
    if (ASSIGNABLE_MODULE_CAPS.includes(c) && c !== CAP.VACANCIES_MANAGE) set.add(c);
  }
  return [...set];
}
