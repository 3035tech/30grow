import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/auth';
import { revokeReportShare } from '../../../../../../../../lib/recruiting/vacancy-report';
import { apiError, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/permissions';


export async function POST(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    const reportId = params?.reportId;
    if (!vacancyId || !reportId) return apiError(request, ERR.INCOMPLETE_DATA, 400);

    const ok = await revokeReportShare(vacancyId, reportId, { isAdmin, companyId });
    if (!ok) return apiError(request, ERR.NOT_FOUND, 404);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[vacancy-report revoke]', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
