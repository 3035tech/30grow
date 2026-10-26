/**
 * GET  /api/admin/succession/critical-roles — list critical roles
 * POST /api/admin/succession/critical-roles — create role
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { listCriticalRoles, createCriticalRole } from '../../../../../lib/development/succession-plans.js';
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
    const includeInactive = url.searchParams.get('includeInactive') === 'true';
    const limit = Number(url.searchParams.get('limit')) || 40;

    const roles = await listCriticalRoles(null, { companyId, includeInactive, limit });
    return NextResponse.json({ roles });
  } catch (err) {
    console.error('GET /api/admin/succession/critical-roles error:', err);
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

    const { title, description, areaKey, impactLevel } = body;

    if (!title || String(title).trim().length === 0) {
      return apiError(request, ERR.TITLE_REQUIRED, 400);
    }

    const result = await createCriticalRole(null, {
      companyId,
      title,
      description,
      areaKey,
      impactLevel,
      createdByUserId: payload.userId,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'critical_role_create',
      actorUserId: payload.userId,
      companyId,
      targetType: 'critical_role',
      targetId: result.role.id,
      metadata: { title: result.role.title, impactLevel: result.role.impactLevel },
    });

    return NextResponse.json(result.role, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/succession/critical-roles error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
