/**
 * GET  /api/admin/succession/plans — list all succession plans (rollup)
 * POST /api/admin/succession/plans — create succession plan (assign successor)
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { listCompanySuccessionPlans, createSuccessionPlan } from '../../../../../lib/development/succession-plans.js';
import { audit } from '../../../../../lib/audit.js';

export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.SUCCESSION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = scope.isAdmin
      ? Number(new URL(request.url).searchParams.get('companyId') || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 40;

    const plans = await listCompanySuccessionPlans(null, { companyId, limit });
    return NextResponse.json({ plans });
  } catch (err) {
    console.error('GET /api/admin/succession/plans error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

export async function POST(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.SUCCESSION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const body = await request.json();
    const companyId = scope.isAdmin
      ? Number(body.companyId || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const roleId = Number(body.roleId);
    const successorId = Number(body.successorId);
    const { readiness, notes, targetDate } = body;

    if (!Number.isFinite(roleId) || roleId <= 0 || !Number.isFinite(successorId) || successorId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const result = await createSuccessionPlan(null, {
      companyId,
      roleId,
      successorId,
      readiness,
      notes,
      targetDate,
      createdByUserId: payload.userId,
    });

    if (!result.ok) {
      if (result.errorCode === 'ROLE_NOT_FOUND' || result.errorCode === 'SUCCESSOR_NOT_FOUND') {
        return apiError(request, result.errorCode, 404);
      }
      if (result.errorCode === 'SUCCESSOR_ALREADY_ASSIGNED') {
        return apiError(request, result.errorCode, 409);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'succession_plan_create',
      actorUserId: payload.userId,
      companyId,
      targetType: 'succession_plan',
      targetId: result.plan.id,
      metadata: { roleId, successorId, readiness: result.plan.readiness },
    });

    return NextResponse.json(result.plan, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/succession/plans error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
