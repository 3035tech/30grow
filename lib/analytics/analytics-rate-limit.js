/**
 * Rate limiting helper para Analytics API (B-1106)
 * Aplica limite conservador de 100 req/min por user_id ou company_id
 */

import { checkRateLimit } from '../rate-limit.js';
import { apiError, ERR } from '../api-error.js';

const ANALYTICS_LIMIT = 100; // requests
const ANALYTICS_WINDOW_MS = 60 * 1000; // 1 minuto

/**
 * Aplica rate limit em rotas de analytics.
 * Retorna NextResponse com 429 se excedido, ou null se OK.
 *
 * @param {Request} request
 * @param {object} scope - { userId, companyId } do getManagerScope
 * @returns {Promise<import('next/server').NextResponse | null>}
 */
export async function checkAnalyticsRateLimit(request, scope) {
  if (!scope || !scope.userId) {
    return null;
  }

  const key = `analytics:u${scope.userId}`;
  const result = await checkRateLimit(key, ANALYTICS_LIMIT, ANALYTICS_WINDOW_MS);

  if (!result.ok) {
    const response = apiError(request, ERR.RATE_LIMIT, 429);
    response.headers.set('X-RateLimit-Limit', String(ANALYTICS_LIMIT));
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + result.retryAfterSec));
    response.headers.set('Retry-After', String(result.retryAfterSec));
    return response;
  }

  return null;
}

/**
 * Adiciona headers de rate limit à resposta de sucesso.
 *
 * @param {import('next/server').NextResponse} response
 * @param {object} scope
 */
export function addRateLimitHeaders(response, scope) {
  if (!scope || !scope.userId) return response;

  response.headers.set('X-RateLimit-Limit', String(ANALYTICS_LIMIT));
  return response;
}
