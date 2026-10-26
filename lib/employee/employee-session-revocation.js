/**
 * session_version for collaborators (candidates) — revoke JWTs without a denylist.
 * Mirrors lib/session-revocation.js for managers.
 */

import { getSharedRedisClient } from '../rate-limit.js';
import { query } from '../db.js';

const CACHE_TTL_SEC = 60 * 60 * 12;

function cacheKey(candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const prefix = String(process.env.REDIS_KEY_PREFIX || 'team30').replace(/:+$/, '');
  return `${prefix}:session:emp-sv:${id}`;
}

export async function setEmployeeSessionVersionCache(candidateId, sessionVersion) {
  const key = cacheKey(candidateId);
  const sv = Number(sessionVersion);
  if (!key || !Number.isFinite(sv) || sv < 1) return;
  const redis = getSharedRedisClient();
  if (!redis) return;
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.set(key, String(sv), 'EX', CACHE_TTL_SEC);
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('pg').Pool|object|null} [dbOrQuery]
 * @param {number} candidateId
 * @param {number} companyId
 * @returns {Promise<number|null>} new session_version
 */
export async function bumpEmployeeSessionVersion(dbOrQuery, candidateId, companyId) {
  const db = dbOrQuery && typeof dbOrQuery.query === 'function' ? dbOrQuery : { query };
  const cid = Number(candidateId);
  const co = Number(companyId);
  if (!Number.isFinite(cid) || !Number.isFinite(co)) return null;
  try {
    const r = await db.query(
      `UPDATE candidates
       SET session_version = COALESCE(session_version, 1) + 1
       WHERE id = $1 AND company_id = $2
       RETURNING session_version AS "sessionVersion"`,
      [cid, co]
    );
    const sv = r.rowCount > 0 ? Number(r.rows[0].sessionVersion) : null;
    if (sv != null) await setEmployeeSessionVersionCache(cid, sv);
    return sv;
  } catch (err) {
    if (err?.code === '42703') return 1;
    throw err;
  }
}

export async function loadEmployeeSessionVersion(candidateId, companyId) {
  const cid = Number(candidateId);
  const co = Number(companyId);
  if (!Number.isFinite(cid) || !Number.isFinite(co)) return null;
  try {
    const r = await query(
      `SELECT COALESCE(session_version, 1) AS "sessionVersion",
              employment_status AS "employmentStatus",
              preferred_locale AS "preferredLocale"
       FROM candidates
       WHERE id = $1 AND company_id = $2
       LIMIT 1`,
      [cid, co]
    );
    if (!r.rowCount) return null;
    return {
      sessionVersion: Number(r.rows[0].sessionVersion) || 1,
      employmentStatus: r.rows[0].employmentStatus,
      preferredLocale: r.rows[0].preferredLocale || null,
    };
  } catch (err) {
    if (err?.code === '42703') {
      return { sessionVersion: 1, employmentStatus: null };
    }
    throw err;
  }
}

/**
 * JWT sv still valid? Redis first; miss → Postgres.
 */
export async function isEmployeeSessionVersionCurrent(candidateId, companyId, sessionVersion) {
  const cid = Number(candidateId);
  const co = Number(companyId);
  const sv = Number(sessionVersion);
  if (!Number.isFinite(cid) || !Number.isFinite(co) || !Number.isFinite(sv) || sv < 1) {
    return false;
  }

  const redis = getSharedRedisClient();
  if (redis) {
    try {
      if (redis.status === 'wait') await redis.connect();
      const key = cacheKey(cid);
      const cached = key ? await redis.get(key) : null;
      if (cached != null) return Number(cached) === sv;
    } catch {
      /* fall through */
    }
  }

  const live = await loadEmployeeSessionVersion(cid, co);
  if (!live) return false;
  await setEmployeeSessionVersionCache(cid, live.sessionVersion);
  return live.sessionVersion === sv;
}
