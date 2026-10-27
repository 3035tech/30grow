/**
 * GET  /api/admin/performance-cycles — list cycles for company
 * POST /api/admin/performance-cycles — create cycle
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error.js';
import {
  getSessionPayload,
  getManagerScope,
  CAP, requireCapability,
  resolveScopedCompanyId,
} from '../../../../lib/ae/require-admin.js';
import { listPerformanceCycles, createPerformanceCycle } from '../../../../lib/development/performance-reviews.js';
import { audit } from '../../../../lib/audit.js';

export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const url = new URL(request.url);
    const companyId = resolveScopedCompanyId(scope, url.searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const limit = Number(url.searchParams.get('limit')) || 40;
    const cycles = await listPerformanceCycles(null, { companyId, limit });
    return NextResponse.json({ cycles });
  } catch (err) {
    console.error('GET /api/admin/performance-cycles error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function POST(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json();
    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const { title, description, status, periodStart, periodEnd, allowSelfReview, allowPeerReview } = body;
    if (!title || String(title).trim().length === 0) {
      return apiError(request, ERR.TITLE_REQUIRED, 400);
    }

    const result = await createPerformanceCycle(null, {
      companyId,
      title,
      description,
      status,
      periodStart,
      periodEnd,
      allowSelfReview: Boolean(allowSelfReview),
      allowPeerReview: Boolean(allowPeerReview),
      createdByUserId: payload.userId,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'performance_cycle_create',
      actorUserId: payload.userId,
      targetType: 'performance_cycle',
      targetId: result.cycle.id,
      metadata: { companyId, title: result.cycle.title, status: result.cycle.status },
    });

    return NextResponse.json(result.cycle, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/performance-cycles error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
