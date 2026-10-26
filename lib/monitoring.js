/**
 * Performance — Monitoring estruturado
 *
 * Logging JSON no stdout (Docker / CloudWatch). Sem SDK externo.
 * Env: LOG_LEVEL = 0|1|2|3 ou debug|info|warn|error (default info).
 */

import { redactSensitiveUrl, redactSensitiveValue } from './identity/redact-secrets.js';

export const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function parseLogLevel() {
  const raw = String(process.env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  if (raw === 'debug' || raw === '0') return LOG_LEVEL.DEBUG;
  if (raw === 'info' || raw === '1') return LOG_LEVEL.INFO;
  if (raw === 'warn' || raw === 'warning' || raw === '2') return LOG_LEVEL.WARN;
  if (raw === 'error' || raw === '3') return LOG_LEVEL.ERROR;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 3) return n;
  return LOG_LEVEL.INFO;
}

const CURRENT_LEVEL = parseLogLevel();

/** Slow query / op threshold (ms). Override: LOG_SLOW_MS */
export function slowThresholdMs() {
  const n = parseInt(String(process.env.LOG_SLOW_MS || '1000'), 10);
  return Number.isFinite(n) && n >= 50 ? n : 1000;
}

/**
 * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
 * @param {string} message
 * @param {object} context
 */
function log(level, message, context = {}) {
  const levelValue = LOG_LEVEL[level.toUpperCase()];
  if (levelValue == null || levelValue < CURRENT_LEVEL) return;

  const safeMessage = redactSensitiveUrl(message);
  const safeContext = redactSensitiveValue(context);
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: safeMessage,
    service: '30team',
    ...safeContext,
  };

  const output = level === 'error' || level === 'warn' ? console.error : console.log;
  output(JSON.stringify(entry));

  // Best-effort bridge to Sentry for ERROR only (no-op without DSN / outside Next)
  if (level === 'error') {
    queueMicrotask(() => {
      import('@sentry/nextjs')
        .then((Sentry) => {
          if (Sentry?.captureMessage) {
            Sentry.captureMessage(safeMessage, { level: 'error', extra: safeContext });
          }
        })
        .catch(() => {});
    });
  }
}

export const logger = {
  debug: (message, context) => log('debug', message, context),
  info: (message, context) => log('info', message, context),
  warn: (message, context) => log('warn', message, context),
  error: (message, context) => log('error', message, context),
};

const metrics = {
  apiCalls: {},
  dbQueries: {},
  cacheHits: 0,
  cacheMisses: 0,
  errors: {},
};

export function incrementMetric(category, key) {
  if (!metrics[category]) metrics[category] = {};
  if (!metrics[category][key]) metrics[category][key] = 0;
  metrics[category][key]++;
}

export function recordDuration(operation, durationMs) {
  const ms = Number(durationMs) || 0;
  incrementMetric('dbQueries', `op:${operation}`);
  if (ms >= slowThresholdMs()) {
    logger.warn('Slow operation detected', { operation, durationMs: ms });
    // Breadcrumb only — avoid Sentry event spam from warn-level slowness
    queueMicrotask(() => {
      import('@sentry/nextjs')
        .then((Sentry) => {
          if (Sentry?.addBreadcrumb) {
            Sentry.addBreadcrumb({
              category: 'performance',
              level: 'warning',
              message: `slow:${operation}`,
              data: { durationMs: ms },
            });
          }
        })
        .catch(() => {});
    });
  }
}

export async function measureAsync(operation, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    recordDuration(operation, Date.now() - start);
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error(`Operation failed: ${operation}`, {
      operation,
      duration,
      error: err?.message || String(err),
    });
    incrementMetric('errors', operation);
    throw err;
  }
}

export function getMetricsSnapshot() {
  return {
    timestamp: new Date().toISOString(),
    ...metrics,
  };
}

export function resetMetrics() {
  metrics.apiCalls = {};
  metrics.dbQueries = {};
  metrics.cacheHits = 0;
  metrics.cacheMisses = 0;
  metrics.errors = {};
}

export async function withApiLogging(request, handler, context = {}) {
  const start = Date.now();
  const pathname = redactSensitiveUrl(new URL(request.url).pathname);
  const method = request.method;
  const routeKey = `${method} ${pathname}`;
  const incomingRequestId = String(request.headers.get('x-request-id') || '').trim();
  const requestId = incomingRequestId.slice(0, 128) || crypto.randomUUID();

  try {
    const response = await handler();
    const duration = Date.now() - start;
    response.headers.set('x-request-id', requestId);
    incrementMetric('apiCalls', routeKey);
    recordDuration(routeKey, duration);
    logger.info('API request', {
      method,
      pathname,
      status: response.status,
      duration,
      requestId,
      ...context,
    });
    return response;
  } catch (err) {
    const duration = Date.now() - start;
    incrementMetric('errors', routeKey);
    logger.error('API error', {
      method,
      pathname,
      duration,
      requestId,
      ...context,
      error: err?.message || String(err),
    });
    throw err;
  }
}

export function getHealthStatus() {
  return {
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    metrics: getMetricsSnapshot(),
  };
}
