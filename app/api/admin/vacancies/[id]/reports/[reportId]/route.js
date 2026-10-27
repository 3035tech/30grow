import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../lib/identity/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../lib/identity/auth';
import { updateReportShareMeta } from '../../../../../../../lib/recruiting/vacancy-report';
import { apiError, ERR } from '../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../lib/identity/permissions';

/** PATCH — atualiza título e/ou parecer de um relatório ainda ativo (snapshot permanece congelado). */
export async function PATCH(request, props) {
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

    const body = await request.json().catch(() => ({}));
    if (body.title === undefined && body.executiveNote === undefined) {
      return apiError(request, ERR.INCOMPLETE_DATA, 400);
    }

    let updated;
    try {
      updated = await updateReportShareMeta(vacancyId, reportId, {
        isAdmin,
        companyId,
        title: body.title,
        executiveNote: body.executiveNote,
      });
    } catch (e) {
      if (e?.code === 'REPORT_NOTE_TOO_SHORT') {
        return apiError(request, ERR.REPORT_NOTE_TOO_SHORT, 400);
      }
      throw e;
    }

    if (!updated) return apiError(request, ERR.NOT_FOUND, 404);
    return NextResponse.json({ ok: true, report: updated });
  } catch (e) {
    console.error('[vacancy-report PATCH]', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
