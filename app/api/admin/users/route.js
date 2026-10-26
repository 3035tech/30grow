import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  publicAppUrl,
  requireCapability,
  resolveScopedCompanyId,
} from '../../../../lib/ae/require-admin';
import { createUser, listUsers } from '../../../../lib/identity/users-admin';

export async function GET(request) {
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.USERS_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const url = new URL(request.url);
  const result = await listUsers({
    page: url.searchParams.get('page') || 1,
    pageSize: url.searchParams.get('pageSize') || 20,
    sort: url.searchParams.get('sort') || 'createdAt',
    sortDir: url.searchParams.get('sortDir') || 'desc',
    q: url.searchParams.get('q') || '',
    role: url.searchParams.get('role') || '',
    active: url.searchParams.get('active') || '',
    filterCompanyId: url.searchParams.get('companyId') || '',
    isAdmin: scope.isAdmin,
    companyId: scope.companyId,
  });

  return NextResponse.json(result);
}

export async function POST(request) {
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.USERS_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const body = await request.json().catch(() => ({}));
  const role = String(body.role || '').trim();
  if (!scope.isAdmin && role === 'admin') {
    return apiError(request, ERR.INVALID_ROLE, 400);
  }

  const companyId = scope.isAdmin
    ? body.companyId ?? null
    : resolveScopedCompanyId(scope, body.companyId);

  const result = await createUser({
    email: body.email,
    password: body.password,
    role,
    companyId,
    modules: body.modules,
    sendInvite: body.sendInvite,
    temporaryPassword: body.temporaryPassword,
    actorUserId: payload?.userId,
    locale: payload?.locale || 'pt-BR',
    appUrl: publicAppUrl(request),
    allowPassword: scope.isAdmin,
  });

  if (!result.ok) {
    return apiError(request, result.errorCode || 'INVALID_DATA', result.status || 400);
  }

  return NextResponse.json(result.user, { status: 201 });
}
