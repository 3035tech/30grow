import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../lib/identity/auth';
import { verifySessionWithCapabilities } from '../../../../../lib/identity/user-capabilities';
import { apiError, ERR } from '../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../lib/identity/permissions';
import { getReferralAnalytics } from '../../../../../lib/marketing/referral-codes';

/**
 * GET /api/admin/referral-codes/analytics?vacancyId=&companyId=
 */
export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_VIEW)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const isAdmin = isSuperAdminPayload(payload);
  const companyId = isAdmin
    ? Number(request.nextUrl.searchParams.get('companyId') || payload?.companyId) || null
    : payload?.companyId ?? null;
  if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const vacancyIdRaw = request.nextUrl.searchParams.get('vacancyId');
  const vacancyId = vacancyIdRaw != null && vacancyIdRaw !== '' ? Number(vacancyIdRaw) : null;

  const result = await getReferralAnalytics({
    companyId,
    isAdmin,
    vacancyId,
  });
  if (!result.ok) {
    const status =
      result.errorCode === 'NOT_FOUND' ? 404 : result.errorCode === 'UNAUTHORIZED' ? 401 : 400;
    return apiError(request, result.errorCode || 'INVALID_DATA', status);
  }
  return NextResponse.json({ items: result.items });
}
