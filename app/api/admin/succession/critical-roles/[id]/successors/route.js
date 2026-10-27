/**
 * GET /api/admin/succession/critical-roles/[id]/successors — list successors for a role
 */

import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../../lib/api-error.js';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../../../../lib/ae/require-admin.js';
import { listSuccessors } from '../../../../../../../lib/development/succession-plans.js';

export async function GET(request, props) {
  const params = await props.params;
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

    const roleId = Number(params.id);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 20;

    const successors = await listSuccessors(null, { companyId, roleId, limit });
    return NextResponse.json({ successors });
  } catch (err) {
    console.error('GET /api/admin/succession/critical-roles/[id]/successors error:', err);
    return apiError(request, ERR.INTERNAL_ERROR, 500);
  }
}
