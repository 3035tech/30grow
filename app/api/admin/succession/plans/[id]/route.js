/**
 * PATCH  /api/admin/succession/plans/[id] — update succession plan
 * DELETE /api/admin/succession/plans/[id] — delete succession plan
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, resolveScopedCompanyId, CAP, requireCapability } from '../../../../../../lib/ae/require-admin.js';
import { updateSuccessionPlan, deleteSuccessionPlan } from '../../../../../../lib/development/succession-plans.js';
import { audit } from '../../../../../../lib/audit.js';


export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.SUCCESSION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json();
    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const planId = Number(params.id);
    if (!Number.isFinite(planId) || planId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const { readiness, notes, targetDate } = body;

    const result = await updateSuccessionPlan(null, {
      companyId,
      planId,
      readiness,
      notes,
      targetDate,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'succession_plan_update',
      actorUserId: payload.userId,
      companyId,
      targetType: 'succession_plan',
      targetId: planId,
      metadata: { readiness: result.plan.readiness },
    });

    return NextResponse.json(result.plan);
  } catch (err) {
    console.error('PATCH /api/admin/succession/plans/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.SUCCESSION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const planId = Number(params.id);
    if (!Number.isFinite(planId) || planId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await deleteSuccessionPlan(null, { companyId, planId });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'succession_plan_delete',
      actorUserId: payload.userId,
      companyId,
      targetType: 'succession_plan',
      targetId: planId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/succession/plans/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
