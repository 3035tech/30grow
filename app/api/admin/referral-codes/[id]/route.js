import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../lib/auth';
import { verifySessionWithCapabilities } from '../../../../../lib/user-capabilities';
import { apiError, ERR } from '../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../lib/permissions';
import { updateReferralCode } from '../../../../../lib/referral-codes';

/**
 * PATCH /api/admin/referral-codes/[id] { active?, label? }
 */
export async function PATCH(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = Number(params?.id);
  if (!Number.isFinite(id) || id <= 0) return apiError(request, ERR.INVALID_ID, 400);

  const body = await request.json().catch(() => ({}));
  const result = await updateReferralCode({
    id,
    companyId,
    isAdmin,
    active: typeof body.active === 'boolean' ? body.active : undefined,
    label: Object.prototype.hasOwnProperty.call(body, 'label') ? body.label : undefined,
  });
  if (!result.ok) {
    const status = result.errorCode === 'NOT_FOUND' ? 404 : result.errorCode === 'UNAUTHORIZED' ? 401 : 400;
    return apiError(request, result.errorCode || 'INVALID_DATA', status);
  }
  return NextResponse.json(result.code);
}
