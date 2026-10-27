import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/identity/auth';
import { verifySessionWithCapabilities } from '../../../../../../lib/identity/user-capabilities';
import { query } from '../../../../../../lib/db';
import { apiError, localeFromRequest, ERR } from '../../../../../../lib/api-error';
import { audit } from '../../../../../../lib/audit';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../lib/identity/permissions';
import { cloneVacancy } from '../../../../../../lib/recruiting/vacancy-clone';
import { ensureActiveVacancyLinkToken } from '../../../../../../lib/recruiting/vacancy-link';

/** POST /api/admin/vacancies/[id]/clone */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const locale = localeFromRequest(request);
    const cloned = await cloneVacancy(query, {
      sourceVacancyId: vacancyId,
      companyId,
      isAdmin,
      locale,
    });
    if (!cloned.ok) {
      return apiError(
        request,
        cloned.errorCode || 'INTERNAL',
        cloned.errorCode === 'NOT_FOUND' ? 404 : cloned.errorCode === 'UNAUTHORIZED' ? 401 : 400
      );
    }

    const activeToken = await ensureActiveVacancyLinkToken(cloned.vacancy.id);

    await audit({
      actorUserId: payload.userId || null,
      action: 'vacancy.clone',
      targetType: 'vacancy',
      targetId: String(cloned.vacancy.id),
      metadata: { sourceVacancyId: Number(vacancyId) },
    });

    return NextResponse.json(
      { ...cloned.vacancy, activeToken },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST vacancy clone', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
