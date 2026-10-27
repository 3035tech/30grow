import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP, publicAppUrl } from '../../../../../../lib/ae/require-admin.js';
import { apiError, ERR } from '../../../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../../../lib/validate.js';
import { query } from '../../../../../../lib/db.js';
import { EMPLOYMENT_STATUS } from '../../../../../../lib/domain-status.js';
import { isValidEmployeeEmail } from '../../../../../../lib/employee/employee-auth.js';
import { ensureActiveCompanyLink } from '../../../../../../lib/public-company-link.js';
import { buildEmployeeEnneagramInviteMail } from '../../../../../../lib/assessment/employee-enneagram-invite-mail.js';
import { enqueueTransactionalMail, isMailConfigured } from '../../../../../../lib/mail.js';
import { checkRateLimit } from '../../../../../../lib/identity/rate-limit.js';
import { audit } from '../../../../../../lib/audit.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  locale: zLocale.optional(),
});

/** Sends the existing internal-team Enneagram link to one employee. */
export const POST = withAdminApi(
  { cap: CAP.TEAM_VIEW, body: bodySchema, requireCompany: false, logLabel: 'employee enneagram invite' },
  async ({ request, payload, scope, body, params }) => {
    const candidateId = Number(params?.id);
    if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return apiError(request, ERR.NOT_FOUND, 404);

    const person = await query(
      `SELECT c.id, c.company_id AS "companyId", c.full_name AS "fullName", c.email,
              c.employment_status AS "employmentStatus", co.name AS "companyName"
       FROM candidates c JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
       WHERE c.id = $1 AND ($2::bigint IS NULL OR c.company_id = $2) LIMIT 1`,
      [candidateId, scope.isAdmin ? null : scope.companyId]
    );
    if (!person.rowCount) return apiError(request, ERR.NOT_FOUND, 404);
    const row = person.rows[0];
    if (body.companyId != null && Number(body.companyId) !== Number(row.companyId)) {
      return apiError(request, ERR.FORBIDDEN, 403);
    }
    if (row.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) return apiError(request, ERR.INVALID_DATA, 400);
    if (!isValidEmployeeEmail(row.email)) return apiError(request, ERR.INVALID_EMAIL, 400);

    const alreadyAnswered = await query(
      'SELECT 1 FROM assessments WHERE candidate_id = $1 AND company_id = $2 LIMIT 1',
      [candidateId, row.companyId]
    );
    if (alreadyAnswered.rowCount) return apiError(request, ERR.ALREADY_SUBMITTED, 409);

    const limit = await checkRateLimit(`employee-enneagram-invite:${payload.userId}`, 40, 60 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT_INVITES, 429);
    if (!isMailConfigured()) return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
    const base = publicAppUrl(request);
    if (!base) return apiError(request, ERR.APP_URL_MISSING, 500);

    const token = await ensureActiveCompanyLink(row.companyId);
    if (!token) return apiError(request, ERR.NOT_FOUND, 404);
    const assessmentUrl = `${base}/t/${token}`;
    const email = row.email.trim().toLowerCase();
    const mail = buildEmployeeEnneagramInviteMail({
      fullName: row.fullName,
      companyName: row.companyName,
      assessmentUrl,
      locale: body.locale || 'pt-BR',
    });
    enqueueTransactionalMail({ to: email, ...mail });
    await audit({
      actorUserId: payload.userId || null,
      companyId: row.companyId,
      action: 'employee.enneagram_invite',
      targetType: 'candidate',
      targetId: String(candidateId),
      metadata: { companyId: row.companyId },
    });
    return NextResponse.json({ ok: true, queued: true, sentTo: email });
  }
);
