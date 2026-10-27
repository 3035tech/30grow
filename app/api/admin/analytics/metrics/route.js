/**
 * B-1101 — Analytics: API de métricas de efetividade
 * GET /api/admin/analytics/metrics
 * B-1106: Rate limiting aplicado
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { getHiringEffectivenessMetrics } from '../../../../../lib/analytics/analytics-metrics.js';
import { checkAnalyticsRateLimit, addRateLimitHeaders } from '../../../../../lib/analytics/analytics-rate-limit.js';
import { withApiLogging } from '../../../../../lib/monitoring.js';
import { isValidAnalyticsDateRange } from '../../../../../lib/analytics/analytics-query.js';

export const GET = withAdminApi({
  cap: CAP.OVERVIEW_VIEW,
  requireCompany: false,
  companyFrom: 'none',
  logLabel: 'analytics.metrics',
}, async ({ request, payload, scope }) => {
  const logContext = { operation: 'analytics.metrics' };
  return withApiLogging(request, async () => {
   try {
    const companyId = scope.isAdmin
      ? Number(new URL(request.url).searchParams.get('companyId') || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) return apiError(request, ERR.COMPANY_REQUIRED, 400);
    logContext.companyId = companyId;

    const rateLimitScope = { ...scope, companyId, userId: payload.userId };
    const rateLimitResponse = await checkAnalyticsRateLimit(request, rateLimitScope);
    if (rateLimitResponse) return rateLimitResponse;

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || null;
    const endDate = searchParams.get('endDate') || null;
    const vacancyId = searchParams.get('vacancyId') || null;
    if (!isValidAnalyticsDateRange(startDate, endDate)) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const metrics = await getHiringEffectivenessMetrics(companyId, {
      startDate,
      endDate,
      vacancyId: vacancyId ? parseInt(vacancyId) : null,
    });

    const response = NextResponse.json({
      ok: true,
      metrics,
      filters: { startDate, endDate, vacancyId },
      meta: {
        generatedAt: new Date().toISOString(),
        period: { startDate, endDate },
        sampleSize: metrics.sampleSize,
      },
    });
    addRateLimitHeaders(response, rateLimitScope);
    return response;
  } catch (err) {
    console.error('[analytics/metrics GET]', err);
    return apiError(request, ERR.SERVER_ERROR, 500);
   }
  }, logContext);
});
