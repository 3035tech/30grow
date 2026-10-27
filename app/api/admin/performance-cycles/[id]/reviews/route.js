/**
 * GET /api/admin/performance-cycles/[id]/reviews — list reviews in a cycle
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../../lib/ae/require-admin.js';
import { listCycleReviews } from '../../../../../../lib/development/performance-reviews.js';

export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = scope.isAdmin
      ? Number(new URL(request.url).searchParams.get('companyId') || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const cycleId = Number(params.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 40;

    const reviews = await listCycleReviews(null, { companyId, cycleId, limit });
    return NextResponse.json({ reviews });
  } catch (err) {
    console.error('GET /api/admin/performance-cycles/[id]/reviews error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
