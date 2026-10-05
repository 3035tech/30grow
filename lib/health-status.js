/**
 * Checagens de dependências para monitoramento (Uptime Kuma / ops).
 * Não envia e-mail nem gasta tokens de chat — só ping/verify leves.
 */

import { query, poolRead, getPoolStats } from './db.js';
import { isMailConfigured, isSmtpMock, verifySmtpConnection } from './mail.js';
import { isOpenAiConfigured, isOpenAiMock, openAiBaseUrl, openAiModelName } from './openai-chat.js';
import { isAiEnabled } from './ai-usage.js';
import { getSharedRedisClient } from './rate-limit.js';
import { checkObjectStorage, isObjectStorageConfigured } from './s3-object-storage.js';

const CHECK_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    }),
  ]);
}

async function checkPostgresPrimary() {
  const started = Date.now();
  try {
    await withTimeout(query('SELECT 1 AS ok'), CHECK_TIMEOUT_MS, 'postgres');
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: e?.message ? String(e.message).slice(0, 200) : 'postgres_failed',
    };
  }
}

async function checkPostgresRead() {
  if (!poolRead) {
    return { status: 'skipped', reason: 'not_configured' };
  }
  const started = Date.now();
  try {
    await withTimeout(poolRead.query('SELECT 1 AS ok'), CHECK_TIMEOUT_MS, 'postgresRead');
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: e?.message ? String(e.message).slice(0, 200) : 'postgres_read_failed',
    };
  }
}

async function checkSchema() {
  const started = Date.now();
  try {
    const result = await withTimeout(
      query(
        `SELECT
           to_regclass('public.schema_migrations') IS NOT NULL AS has_migrations,
           to_regclass('public.candidate_dp_profiles') IS NOT NULL AS has_dp,
           EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'candidate_dp_profiles'
               AND column_name = 'address_number'
           ) AS has_address_number`
      ),
      CHECK_TIMEOUT_MS,
      'schema'
    );
    const row = result.rows[0] || {};
    const missing = [];
    if (!row.has_migrations) missing.push('schema_migrations');
    if (!row.has_dp) missing.push('candidate_dp_profiles');
    if (!row.has_address_number) missing.push('candidate_dp_profiles.address_number');
    return missing.length
      ? { status: 'down', latencyMs: Date.now() - started, missing }
      : { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - started, error: error?.message || 'schema_failed' };
  }
}

async function checkRedis() {
  const redis = getSharedRedisClient();
  if (!redis) return { status: 'skipped', reason: 'not_configured' };
  const started = Date.now();
  try {
    if (redis.status === 'wait') await withTimeout(redis.connect(), CHECK_TIMEOUT_MS, 'redis_connect');
    await withTimeout(redis.ping(), CHECK_TIMEOUT_MS, 'redis');
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - started, error: error?.message || 'redis_failed' };
  }
}

async function checkSmtp() {
  if (isSmtpMock()) {
    return { status: 'up', latencyMs: 0, mocked: true };
  }
  if (!isMailConfigured()) {
    return { status: 'skipped', reason: 'not_configured' };
  }
  const result = await verifySmtpConnection(CHECK_TIMEOUT_MS);
  if (result.ok) {
    return { status: 'up', latencyMs: result.latencyMs };
  }
  return {
    status: 'down',
    latencyMs: result.latencyMs,
    error: result.error || 'smtp_failed',
  };
}

async function checkOpenAi() {
  if (!isAiEnabled()) {
    return { status: 'skipped', reason: 'disabled' };
  }
  if (isOpenAiMock()) {
    return { status: 'up', latencyMs: 0, mocked: true, model: openAiModelName() };
  }
  if (!isOpenAiConfigured()) {
    return { status: 'skipped', reason: 'not_configured' };
  }
  const started = Date.now();
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  try {
    const res = await withTimeout(
      fetch(`${openAiBaseUrl()}/models?limit=1`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      }),
      CHECK_TIMEOUT_MS + 500,
      'openai'
    );
    if (!res.ok) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        error: `HTTP ${res.status}`,
        model: openAiModelName(),
      };
    }
    return {
      status: 'up',
      latencyMs: Date.now() - started,
      model: openAiModelName(),
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: e?.message ? String(e.message).slice(0, 200) : 'openai_failed',
      model: openAiModelName(),
    };
  }
}

/**
 * @returns {Promise<{
 *   status: 'ok'|'degraded'|'down',
 *   checkedAt: string,
 *   latencyMs: number,
 *   services: Record<string, object>,
 *   pg?: object
 * }>}
 */
export async function collectHealthStatus() {
  const started = Date.now();
  const [postgres, postgresRead, schema, redis, storage, smtp, openai] = await Promise.all([
    checkPostgresPrimary(),
    checkPostgresRead(),
    checkSchema(),
    checkRedis(),
    isObjectStorageConfigured()
      ? checkObjectStorage(CHECK_TIMEOUT_MS)
      : Promise.resolve({ status: 'skipped', reason: 'not_configured' }),
    checkSmtp(),
    checkOpenAi(),
  ]);

  const services = {
    app: { status: 'up', latencyMs: 0 },
    postgres,
    postgresRead,
    schema,
    redis,
    storage,
    smtp,
    openai,
  };

  const requiredDown = [postgres, schema].some((s) => s.status === 'down');
  const optionalConfiguredDown = [postgresRead, redis, storage, smtp, openai].some((s) => s.status === 'down');

  let status = 'ok';
  if (requiredDown) status = 'down';
  else if (optionalConfiguredDown) status = 'degraded';

  return {
    status,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    services,
    pg: getPoolStats(),
  };
}

export function isHealthStatusTokenValid(request) {
  const secret = String(process.env.HEALTH_STATUS_TOKEN ?? '').trim();
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer && bearer === secret) return true;
  const hdr = (request.headers.get('x-health-status-token') || '').trim();
  return hdr === secret;
}
