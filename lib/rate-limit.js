/**
 * Rate limit — fixed window.
 * Priority:
 * 1. REDIS_URL (Redis clássico / Dublin `redis-haproxy.redis.svc`) via ioredis
 * 2. In-memory per Node process (local / sem Redis)
 *
 * Always async — callers must `await checkRateLimit(...)`.
 */

import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { logger, incrementMetric } from './monitoring.js';

const buckets = new Map();
const MAX_KEYS = 5000;

// One command assigns the expiry together with the first increment.
const INCREMENT_WINDOW_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

/** @type {import('ioredis').Redis | null | undefined} */
let ioredisClient;
/** @type {boolean} */
let redisUnavailable = false;
let redisBootLogged = false;

function pruneIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size <= MAX_KEYS * 0.8) break;
  }
}

function keyPrefix() {
  const p = (process.env.REDIS_KEY_PREFIX || 'team30').trim().replace(/:+$/, '');
  return p || 'team30';
}

/** Host only — never log password from REDIS_URL. */
function redisHostHint(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '6379'}`;
  } catch {
    return 'invalid-url';
  }
}

function getIoredis() {
  if (redisUnavailable) return null;
  if (ioredisClient !== undefined) return ioredisClient;
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) {
    ioredisClient = null;
    if (!redisBootLogged) {
      redisBootLogged = true;
      logger.info('Redis not configured; rate limit uses memory', { backend: 'memory' });
    }
    return null;
  }
  try {
    ioredisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    ioredisClient.on('ready', () => {
      logger.info('Redis ready', { host: redisHostHint(url), keyPrefix: keyPrefix() });
    });
    ioredisClient.on('error', (err) => {
      logger.warn('Redis error', { host: redisHostHint(url), error: err?.message || String(err) });
    });
    ioredisClient.on('end', () => {
      logger.warn('Redis connection ended', { host: redisHostHint(url) });
    });
    if (!redisBootLogged) {
      redisBootLogged = true;
      logger.info('Redis client initialized', { host: redisHostHint(url), keyPrefix: keyPrefix() });
    }
    return ioredisClient;
  } catch (err) {
    logger.warn('Redis init failed; using memory', {
      host: redisHostHint(url),
      error: err?.message || String(err),
    });
    redisUnavailable = true;
    ioredisClient = null;
    return null;
  }
}

function checkRateLimitMemory(key, limit, windowMs) {
  if (!key) return { ok: true };
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    // Prune antes de inserir: evita crescer o Map além do teto entre chamadas.
    pruneIfNeeded();
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  if (b.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  b.count += 1;
  return { ok: true };
}

/**
 * Shared fixed-window via classic Redis (atomic INCR + PEXPIRE).
 * @returns {Promise<{ ok: true } | { ok: false, retryAfterSec: number } | null>}
 */
async function checkRateLimitRedis(key, limit, windowMs) {
  const redis = getIoredis();
  if (!redis) return null;
  const windowId = Math.floor(Date.now() / windowMs);
  const redisKey = `${keyPrefix()}:rl:v1:${key}:${windowId}`;
  try {
    if (redis.status === 'wait') {
      await redis.connect();
    }
    // Increment and expiry are atomic: interrupted requests cannot leave immortal buckets.
    const count = Number(await redis.eval(INCREMENT_WINDOW_LUA, 1, redisKey, windowMs));
    if (count > limit) {
      const ttl = await redis.pttl(redisKey);
      const retryAfterSec = Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000));
      return { ok: false, retryAfterSec };
    }
    return { ok: true };
  } catch (err) {
    logger.warn('Redis call failed; falling back to memory', {
      error: err?.message || String(err),
    });
    return null;
  }
}

/**
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {Promise<{ ok: true } | { ok: false, retryAfterSec: number }>}
 */
export async function checkRateLimit(key, limit, windowMs) {
  if (!key) return { ok: true };
  const remote = await checkRateLimitRedis(key, limit, windowMs);
  const result = remote || checkRateLimitMemory(key, limit, windowMs);
  if (!result.ok) {
    incrementMetric('security', 'rate_limit_blocked');
    logger.warn('Security rate limit blocked', {
      event: 'security.rate_limit_blocked',
      subjectHash: createHash('sha256').update(key).digest('hex'),
      backend: remote ? 'redis' : 'memory',
      retryAfterSec: result.retryAfterSec,
    });
  }
  return result;
}

/** Redis compartilhado (rate limit + session revocation cache). */
export function getSharedRedisClient() {
  return getIoredis();
}

export function clientIpFromRequest(request) {
  const xf = request.headers.get('x-forwarded-for');
  if (xf) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  return 'unknown';
}

/** Fecha o cliente Redis (útil em scripts/DTOV para o processo poder sair). */
export async function closeRateLimitRedis() {
  if (!ioredisClient) {
    ioredisClient = undefined;
    return;
  }
  const client = ioredisClient;
  ioredisClient = undefined;
  try {
    await client.quit();
  } catch {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Normalizes the account identity so web/mobile use the same bucket.
 * @param {string} kind - Authentication flow, e.g. employee-login.
 * @param {string} email
 * @returns {string} Rate-limit key without the email in plain text.
 */
export function accountRateLimitKey(kind, email) {
  const normalized = String(email || '').trim().toLowerCase();
  return `${kind}-account:${createHash('sha256').update(normalized).digest('hex')}`;
}
