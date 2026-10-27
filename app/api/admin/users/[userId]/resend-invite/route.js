import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  publicAppUrl,
  requireCapability,
} from '../../../../../../lib/ae/require-admin';
import { resendUserPasswordInvite } from '../../../../../../lib/identity/users-admin';

export const dynamic = 'force-dynamic';

/** POST /api/admin/users/:userId/resend-invite — reenvia e-mail para definir senha. */
export async function POST(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.USERS_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const userId = params?.userId ? parseInt(String(params.userId), 10) : NaN;
  if (!Number.isFinite(userId)) return apiError(request, ERR.INVALID_USER, 400);

  const result = await resendUserPasswordInvite({
    userId,
    actorUserId: payload?.userId,
    locale: payload?.locale || 'pt-BR',
    appUrl: publicAppUrl(request),
    isAdmin: scope.isAdmin,
    scopeCompanyId: scope.companyId,
  });

  if (!result.ok) {
    return apiError(request, result.errorCode || 'INTERNAL', result.status || 400);
  }

  return NextResponse.json({
    ok: true,
    inviteSent: true,
    email: result.email,
    expiresAt: result.expiresAt,
  });
}
