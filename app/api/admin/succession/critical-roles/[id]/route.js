/**
 * GET   /api/admin/succession/critical-roles/[id] — get role details
 * PATCH /api/admin/succession/critical-roles/[id] — update role
 * DELETE /api/admin/succession/critical-roles/[id] — deactivate role
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, resolveScopedCompanyId, CAP, requireCapability } from '../../../../../../lib/ae/require-admin.js';
import { getCriticalRole, updateCriticalRole, deactivateCriticalRole } from '../../../../../../lib/development/succession-plans.js';
import { audit } from '../../../../../../lib/audit.js';


export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.SUCCESSION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const roleId = Number(params.id);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const role = await getCriticalRole(null, { companyId, roleId });
    if (!role) return apiError(request, ERR.NOT_FOUND, 404);

    return NextResponse.json(role);
  } catch (err) {
    console.error('GET /api/admin/succession/critical-roles/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}

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

    const roleId = Number(params.id);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const { title, description, areaKey, impactLevel, active } = body;

    const result = await updateCriticalRole(null, {
      companyId,
      roleId,
      title,
      description,
      areaKey,
      impactLevel,
      active,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'critical_role_update',
      actorUserId: payload.userId,
      companyId,
      targetType: 'critical_role',
      targetId: roleId,
      metadata: { title: result.role.title },
    });

    return NextResponse.json(result.role);
  } catch (err) {
    console.error('PATCH /api/admin/succession/critical-roles/[id] error:', err);
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

    const roleId = Number(params.id);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await deactivateCriticalRole(null, { companyId, roleId });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, result.errorCode, 400);
    }

    await audit({
      action: 'critical_role_deactivate',
      actorUserId: payload.userId,
      companyId,
      targetType: 'critical_role',
      targetId: roleId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/admin/succession/critical-roles/[id] error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
