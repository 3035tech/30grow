/**
 * B-1103 — Analytics: API de comparativos
 * GET /api/admin/analytics/compare
 * B-1106: Rate limiting aplicado
 * 
 * Query params:
 * - type: 'areas' | 'periods' | 'rubrics'
 * - areaA, areaB (for areas)
 * - periodAStart, periodAEnd, periodBStart, periodBEnd (for periods)
 * - rubricAId, rubricBId (for rubrics)
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import {
  compareAreas,
  comparePeriods,
  compareRubrics,
  listAvailableAreas,
  listAvailableRubrics,
} from '../../../../../lib/analytics/analytics-comparisons.js';
import { checkAnalyticsRateLimit, addRateLimitHeaders } from '../../../../../lib/analytics/analytics-rate-limit.js';
import { withApiLogging } from '../../../../../lib/monitoring.js';
import { isValidAnalyticsDateRange } from '../../../../../lib/analytics/analytics-query.js';

export async function GET(request) {
  const logContext = { operation: 'analytics.compare' };
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
    const type = searchParams.get('type');

    // List available options
    if (type === 'list-areas') {
      const areas = await listAvailableAreas(companyId);
      const response = NextResponse.json({ ok: true, areas });
      addRateLimitHeaders(response, rateLimitScope);
      return response;
    }

    if (type === 'list-rubrics') {
      const rubrics = await listAvailableRubrics(companyId);
      const response = NextResponse.json({ ok: true, rubrics });
      addRateLimitHeaders(response, rateLimitScope);
      return response;
    }

    // Comparisons
    if (type === 'areas') {
      const areaA = searchParams.get('areaA');
      const areaB = searchParams.get('areaB');

      if (!areaA || !areaB) {
        return apiError(request, ERR.MISSING_PARAMS, 400);
      }

      const comparison = await compareAreas(companyId, areaA, areaB);
      const response = NextResponse.json({ ok: true, comparison });
      addRateLimitHeaders(response, rateLimitScope);
      return response;
    }

    if (type === 'periods') {
      const periodAStart = searchParams.get('periodAStart');
      const periodAEnd = searchParams.get('periodAEnd');
      const periodBStart = searchParams.get('periodBStart');
      const periodBEnd = searchParams.get('periodBEnd');

      if (!periodAStart || !periodAEnd || !periodBStart || !periodBEnd) {
        return apiError(request, ERR.MISSING_PARAMS, 400);
      }
      if (
        !isValidAnalyticsDateRange(periodAStart, periodAEnd) ||
        !isValidAnalyticsDateRange(periodBStart, periodBEnd)
      ) {
        return apiError(request, ERR.INVALID_PARAMS, 400);
      }

      const comparison = await comparePeriods(
        companyId,
        periodAStart,
        periodAEnd,
        periodBStart,
        periodBEnd
      );
      const response = NextResponse.json({ ok: true, comparison });
      addRateLimitHeaders(response, rateLimitScope);
      return response;
    }

    if (type === 'rubrics') {
      const rubricAId = parseInt(searchParams.get('rubricAId'));
      const rubricBId = parseInt(searchParams.get('rubricBId'));

      if (!rubricAId || !rubricBId) {
        return apiError(request, ERR.MISSING_PARAMS, 400);
      }

      const comparison = await compareRubrics(companyId, rubricAId, rubricBId);
      const response = NextResponse.json({ ok: true, comparison });
      addRateLimitHeaders(response, rateLimitScope);
      return response;
    }

    return apiError(request, ERR.INVALID_TYPE, 400);
  } catch (err) {
    console.error('[analytics/compare GET]', err);
    return apiError(request, ERR.SERVER_ERROR, 500);
   }
  }, logContext);
}
