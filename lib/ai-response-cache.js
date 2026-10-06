/**
 * B-2705 — cache of repeated LLM answers (same feature + model + normalized input).
 * Redis when configured (shared across instances), small in-process LRU otherwise.
 * Scope: `c<companyId>` when the prompt carries company data, `g` when it does not.
 * AI_RESPONSE_CACHE=0 turns it off.
 */

import crypto from 'node:crypto';
import { getSharedRedisClient } from './rate-limit.js';
import { incrementMetric } from './monitoring.js';

export const AI_CACHE_TTL_SEC = 24 * 60 * 60;
const MEMORY_CAP = 500;
const memory = new Map();

export function isAiResponseCacheEnabled() {
  return String(process.env.AI_RESPONSE_CACHE ?? '').trim() !== '0';
}

function keyPrefix() {
  return (process.env.REDIS_KEY_PREFIX || 'team30').trim().replace(/:+$/, '') || 'team30';
}

const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param {{ feature: string, model: string, companyId?: number|null, messages: {role:string,content:string}[],
 *   temperature?: number, maxTokens?: number, responseFormat?: string|null }} input
 * @returns {string|null} null when the scope is invalid (never cache under a guessed tenant).
 */
export function aiResponseCacheKey({ feature, model, companyId = null, messages, temperature, maxTokens, responseFormat }) {
  let scope = 'g';
  if (companyId != null) {
    const id = Number(companyId);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    scope = `c${id}`;
  }
  const payload = JSON.stringify({
    model,
    temperature: temperature ?? null,
    maxTokens: maxTokens ?? null,
    responseFormat: responseFormat || null,
    messages: (Array.isArray(messages) ? messages : []).map((m) => [m?.role || '', normalize(m?.content)]),
  });
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `${keyPrefix()}:ai:v1:${scope}:${feature || 'none'}:${hash}`;
}

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  memory.delete(key);
  memory.set(key, hit);
  return hit.text;
}

function memorySet(key, text, ttlSec) {
  memory.delete(key);
  memory.set(key, { text, expiresAt: Date.now() + ttlSec * 1000 });
  while (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value);
}

async function redisReady() {
  const redis = getSharedRedisClient();
  if (!redis) return null;
  if (redis.status === 'wait') await redis.connect();
  return redis;
}

/** @returns {Promise<string|null>} */
export async function readAiResponseCache(key) {
  if (!key) return null;
  let text = null;
  try {
    const redis = await redisReady();
    text = redis ? await redis.get(key) : memoryGet(key);
  } catch {
    text = memoryGet(key);
  }
  incrementMetric('aiCache', text ? 'hit' : 'miss');
  return text || null;
}

export async function writeAiResponseCache(key, text, ttlSec = AI_CACHE_TTL_SEC) {
  if (!key || !text) return;
  try {
    const redis = await redisReady();
    if (redis) {
      await redis.set(key, text, 'EX', ttlSec);
      return;
    }
  } catch {
    /* memory fallback */
  }
  memorySet(key, text, ttlSec);
}

export function __resetAiResponseCacheMemory() {
  memory.clear();
}
