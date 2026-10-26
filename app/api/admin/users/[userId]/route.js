import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  requireCapability,
} from '../../../../../lib/ae/require-admin';
import { deactivateUser, updateUser } from '../../../../../lib/identity/users-admin';

export async function PATCH(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.USERS_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.userId;
  const userId = id ? parseInt(String(id), 10) : NaN;
  if (!Number.isFinite(userId)) return apiError(request, ERR.INVALID_USER, 400);

  const body = await request.json().catch(() => ({}));
  const result = await updateUser({
    userId,
    body,
    actorUserId: payload?.userId,
    isAdmin: scope.isAdmin,
    scopeCompanyId: scope.companyId,
  });

  if (!result.ok) {
    return apiError(request, result.errorCode || 'INVALID_DATA', result.status || 400);
  }

  return NextResponse.json(result.user);
}

export async function DELETE(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.USERS_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.userId;
  const userId = id ? parseInt(String(id), 10) : NaN;
  if (!Number.isFinite(userId)) return apiError(request, ERR.INVALID_USER, 400);

  const result = await deactivateUser({
    userId,
    actorUserId: payload?.userId,
    isAdmin: scope.isAdmin,
    scopeCompanyId: scope.companyId,
  });

  if (!result.ok) {
    return apiError(request, result.errorCode || 'INVALID_DATA', result.status || 400);
  }

  return NextResponse.json({ ok: true });
}
