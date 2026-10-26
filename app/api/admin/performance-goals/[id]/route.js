/**
 * PATCH  /api/admin/performance-goals/[id] — update goal
 * DELETE /api/admin/performance-goals/[id] — delete goal
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, resolveScopedCompanyId, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { updatePerformanceGoal, deletePerformanceGoal } from '../../../../../lib/development/performance-reviews.js';
import { audit } from '../../../../../lib/audit.js';


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

    const goalId = Number(params.id);
    if (!Number.isFinite(goalId) || goalId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const { title, description, weight, sortOrder } = body;

    const result = await updatePerformanceGoal(null, {
      companyId,
      goalId,
      title,
      description,
      weight,
      sortOrder,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'performance_goal_update',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_goal',
      targetId: goalId,
      metadata: { title: result.goal.title },
    });

    return NextResponse.json(result.goal);
  } catch (err) {
    console.error('PATCH /api/admin/performance-goals/[id] error:', err);
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

    const goalId = Number(params.id);
    if (!Number.isFinite(goalId) || goalId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await deletePerformanceGoal(null, {
      companyId,
      goalId,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'performance_goal_delete',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_goal',
      targetId: goalId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/performance-goals/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
