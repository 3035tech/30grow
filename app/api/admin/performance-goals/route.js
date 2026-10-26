/**
 * GET  /api/admin/performance-goals?cycleId=X&candidateId=Y — list goals
 * POST /api/admin/performance-goals — create goal
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../lib/ae/require-admin.js';
import { listPerformanceGoals, createPerformanceGoal } from '../../../../lib/development/performance-reviews.js';
import { audit } from '../../../../lib/audit.js';

export async function GET(request) {
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

    const url = new URL(request.url);
    const cycleId = Number(url.searchParams.get('cycleId'));
    const candidateId = Number(url.searchParams.get('candidateId'));
    const limit = Number(url.searchParams.get('limit')) || 20;

    if (!Number.isFinite(cycleId) || cycleId <= 0 || !Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    const goals = await listPerformanceGoals(null, {
      companyId,
      cycleId,
      candidateId,
      limit,
    });

    return NextResponse.json({ goals });
  } catch (err) {
    console.error('GET /api/admin/performance-goals error:', err);
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
    const companyId = scope.isAdmin
      ? Number(body.companyId || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const { cycleId, candidateId, title, description, weight, sortOrder } = body;

    if (!Number.isFinite(cycleId) || cycleId <= 0 || !Number.isFinite(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }

    if (!title || String(title).trim().length === 0) {
      return apiError(request, ERR.TITLE_REQUIRED, 400);
    }

    const result = await createPerformanceGoal(null, {
      companyId,
      cycleId,
      candidateId,
      title,
      description,
      weight,
      sortOrder,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      if (result.errorCode === 'CYCLE_NOT_FOUND') {
        return apiError(request, ERR.CYCLE_NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'performance_goal_create',
      actorUserId: payload.userId,
      companyId,
      targetType: 'performance_goal',
      targetId: result.goal.id,
      metadata: { cycleId, candidateId, title: result.goal.title },
    });

    return NextResponse.json(result.goal, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/performance-goals error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
