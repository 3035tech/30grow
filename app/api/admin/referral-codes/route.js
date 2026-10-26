import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/identity/auth';
import { verifySessionWithCapabilities } from '../../../../lib/identity/user-capabilities';
import { apiError, ERR } from '../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../lib/identity/permissions';
import { createReferralCode, listReferralCodes } from '../../../../lib/marketing/referral-codes';

/**
 * GET /api/admin/referral-codes?vacancyId=&activeOnly=1&companyId=
 * POST /api/admin/referral-codes { code?, vacancyId?, label?, ownerUserId?, ownerCandidateId?, companyId? }
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
  const activeOnly = ['1', 'true', 'yes'].includes(
    String(request.nextUrl.searchParams.get('activeOnly') || '').toLowerCase()
  );

  const result = await listReferralCodes({
    companyId,
    isAdmin,
    vacancyId,
    activeOnly,
  });
  if (!result.ok) {
    return apiError(request, result.errorCode || 'UNAUTHORIZED', 401);
  }
  return NextResponse.json({ items: result.items });
}

export async function POST(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const isAdmin = isSuperAdminPayload(payload);
  const body = await request.json().catch(() => ({}));
  const companyId = isAdmin
    ? Number(body.companyId || payload?.companyId)
    : payload?.companyId ?? null;
  if (!companyId) return apiError(request, ERR.INVALID_COMPANY, 400);

  const result = await createReferralCode({
    companyId,
    vacancyId: body.vacancyId ?? null,
    code: body.code ?? null,
    label: body.label ?? null,
    ownerUserId: body.ownerUserId ?? payload?.userId ?? null,
    ownerCandidateId: body.ownerCandidateId ?? null,
  });
  if (!result.ok) {
    const status =
      result.errorCode === 'DUPLICATE_REFERRAL_CODE'
        ? 409
        : result.errorCode === 'UNAUTHORIZED'
          ? 401
          : 400;
    return apiError(request, result.errorCode || 'INVALID_DATA', status);
  }
  return NextResponse.json(result.code, { status: 201 });
}
