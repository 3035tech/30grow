/**
 * Performance — Endpoint de métricas e health check
 * GET /api/health/metrics
 * 
 * Retorna métricas agregadas + health status
 * Admin-only para segurança
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { getSessionPayload, requireAdminRole } from '../../../../lib/ae/require-admin.js';
import { getHealthStatus } from '../../../../lib/monitoring.js';
import { getHrScoreCacheMetrics } from '../../../../lib/assessment/hr-score-cache.js';

export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireAdminRole(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const health = getHealthStatus();
    const hrScoreCache = getHrScoreCacheMetrics();

    return NextResponse.json({
      ok: true,
      health: {
        ...health,
        caches: {
          hrScore: hrScoreCache,
        },
      },
    });
  } catch (err) {
    console.error('[health/metrics GET]', err);
    return apiError(request, ERR.SERVER_ERROR, 500);
  }
}
