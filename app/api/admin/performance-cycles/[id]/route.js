/**
 * GET   /api/admin/performance-cycles/[id] — get cycle details
 * PATCH /api/admin/performance-cycles/[id] — update cycle
 * DELETE /api/admin/performance-cycles/[id] — delete draft or close cycle
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, resolveScopedCompanyId, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { getPerformanceCycle, updatePerformanceCycle, deletePerformanceCycle } from '../../../../../lib/development/performance-reviews.js';
import { audit } from '../../../../../lib/audit.js';


export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const cycleId = Number(params.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const cycle = await getPerformanceCycle(null, { companyId, cycleId });
    if (!cycle) return apiError(request, ERR.NOT_FOUND, 404);

    return NextResponse.json(cycle);
  } catch (err) {
    console.error('GET /api/admin/performance-cycles/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json();
    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const cycleId = Number(params.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const { title, description, status, periodStart, periodEnd, allowSelfReview, allowPeerReview } = body;

    const result = await updatePerformanceCycle(null, {
      companyId,
      cycleId,
      title,
      description,
      status,
      periodStart,
      periodEnd,
      allowSelfReview,
      allowPeerReview,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'performance_cycle_update',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_cycle',
      targetId: cycleId,
      metadata: { title: result.cycle.title, status: result.cycle.status },
    });

    return NextResponse.json(result.cycle);
  } catch (err) {
    console.error('PATCH /api/admin/performance-cycles/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.PERFORMANCE_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const cycleId = Number(params.id);
    if (!Number.isFinite(cycleId) || cycleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await deletePerformanceCycle(null, { companyId, cycleId });
    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: result.mode === 'deleted' ? 'performance_cycle_delete' : 'performance_cycle_close',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_cycle',
      targetId: cycleId,
      metadata: { mode: result.mode },
    });

    return NextResponse.json({ ok: true, mode: result.mode });
  } catch (err) {
    console.error('DELETE /api/admin/performance-cycles/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
