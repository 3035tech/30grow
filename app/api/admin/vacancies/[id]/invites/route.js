import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/auth';
import { queryRead } from '../../../../../../lib/db';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../lib/permissions';


export async function GET(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const own = await queryRead(
      `SELECT v.id FROM vacancies v WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $2' : ''} LIMIT 1`,
      !isAdmin ? [vacancyId, companyId] : [vacancyId]
    );
    if (own.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

    const list = await queryRead(
      `SELECT
         ci.id,
         ci.candidate_name AS "candidateName",
         ci.candidate_email AS "candidateEmail",
         ci.status,
         ci.sent_at AS "sentAt",
         ci.opened_at AS "openedAt",
         ci.completed_at AS "completedAt",
         ci.last_reminder_at AS "lastReminderAt",
         ci.reminder_count AS "reminderCount"
       FROM candidate_invites ci
       WHERE ci.vacancy_id = $1
       ORDER BY ci.sent_at DESC
       LIMIT 200`,
      [vacancyId]
    );

    return NextResponse.json({ invites: list.rows });
  } catch (e) {
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
