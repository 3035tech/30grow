/**
 * Persist / load companies.enabled_modules (nullable = all).
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import {
  COMPANY_MODULE_CORE,
  normalizeEnabledModules,
} from './company-modules.js';

export async function getCompanyEnabledModules(dbOrQuery, companyId) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  try {
    const res = await db.query(
      `SELECT enabled_modules AS "enabledModules"
       FROM companies
       WHERE id = $1 AND deleted = FALSE
       LIMIT 1`,
      [cid]
    );
    if (res.rowCount === 0) return null;
    return normalizeEnabledModules(res.rows[0].enabledModules);
  } catch (err) {
    // Pré-migration 109
    if (err?.code === '42703') return null;
    throw err;
  }
}

/**
 * @param {string[]|null} modules null clears (all modules)
 */
export async function setCompanyEnabledModules(dbOrQuery, { companyId, modules }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.INVALID_COMPANY };

  let next = null;
  if (modules != null) {
    next = normalizeEnabledModules(modules);
    if (!next) {
      next = [COMPANY_MODULE_CORE];
    }
  }

  try {
    const res = await db.query(
      `UPDATE companies
       SET enabled_modules = $2::text[]
       WHERE id = $1 AND deleted = FALSE
       RETURNING id, enabled_modules AS "enabledModules"`,
      [cid, next]
    );
    if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    return {
      ok: true,
      enabledModules: normalizeEnabledModules(res.rows[0].enabledModules),
    };
  } catch (err) {
    if (err?.code === '42703') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}
