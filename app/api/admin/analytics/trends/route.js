/**
 * B-1102 — Analytics: API de tendências temporais
 * GET /api/admin/analytics/trends
 * B-1106: Rate limiting aplicado
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { getAllTrends } from '../../../../../lib/analytics/analytics-trends.js';
import { checkAnalyticsRateLimit, addRateLimitHeaders } from '../../../../../lib/analytics/analytics-rate-limit.js';
import { withApiLogging } from '../../../../../lib/monitoring.js';
import { isValidAnalyticsMonths } from '../../../../../lib/analytics/analytics-query.js';

export async function GET(request) {
  const logContext = { operation: 'analytics.trends' };
  return withApiLogging(request, async () => {
   try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.OVERVIEW_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);
    const companyId = scope.isAdmin
      ? Number(new URL(request.url).searchParams.get('companyId') || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) return apiError(request, ERR.COMPANY_REQUIRED, 400);
    logContext.companyId = companyId;

    const rateLimitScope = { ...scope, companyId, userId: payload.userId };
    const rateLimitResponse = await checkAnalyticsRateLimit(request, rateLimitScope);
    if (rateLimitResponse) return rateLimitResponse;

    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '12', 10);

    if (!isValidAnalyticsMonths(months)) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const trends = await getAllTrends(companyId, { months });

    const response = NextResponse.json({
      ok: true,
      trends,
      filters: { months },
      meta: { generatedAt: new Date().toISOString(), months },
    });
    addRateLimitHeaders(response, rateLimitScope);
    return response;
  } catch (err) {
    console.error('[analytics/trends GET]', err);
    return apiError(request, ERR.SERVER_ERROR, 500);
   }
  }, logContext);
}
