/**
 * Cache Redis da session_version por userId — permite invalidar JWT no middleware (via session-edge).
 */

import { query } from '../db.js';
import { getSharedRedisClient } from './rate-limit.js';

const CACHE_TTL_SEC = 8 * 60 * 60 + 600; // ~8h JWT + margem

function cacheKey(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const prefix = (process.env.REDIS_KEY_PREFIX || 'team30').trim().replace(/:+$/, '') || 'team30';
  return `${prefix}:session:sv:${id}`;
}

/** @returns {Promise<void>} */
export async function setSessionVersionCache(userId, sessionVersion) {
  const key = cacheKey(userId);
  const sv = Number(sessionVersion);
  if (!key || !Number.isFinite(sv) || sv < 1) return;

  const redis = getSharedRedisClient();
  if (redis) {
    try {
      if (redis.status === 'wait') await redis.connect();
      await redis.set(key, String(sv), 'EX', CACHE_TTL_SEC);
      return;
    } catch {
      /* fall through */
    }
  }
}

/**
 * JWT sv ainda válido? Redis primeiro; miss → Postgres.
 * @returns {Promise<boolean>}
 */
export async function isSessionVersionCurrent(userId, sessionVersion) {
  const id = Number(userId);
  const sv = Number(sessionVersion);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(sv) || sv < 1) return false;

  const key = cacheKey(id);
  const redis = getSharedRedisClient();
  if (redis && key) {
    try {
      if (redis.status === 'wait') await redis.connect();
      const cached = await redis.get(key);
      if (cached != null && cached !== '') {
        return Number(cached) === sv;
      }
    } catch {
      /* DB fallback */
    }
  }

  try {
    const r = await query(
      `SELECT session_version AS "sessionVersion", active, deleted
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (r.rowCount === 0) return false;
    const row = r.rows[0];
    if (!row.active || row.deleted) return false;
    const dbSv = Number(row.sessionVersion);
    if (!Number.isFinite(dbSv) || dbSv < 1) return false;
    await setSessionVersionCache(id, dbSv);
    return dbSv === sv;
  } catch (err) {
    if (err?.code === '42703') return sv >= 1;
    return false;
  }
}
