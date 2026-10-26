import { candidateContact } from '../../../../../../../../lib/recruiting/candidate-contact';
import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/auth';
import { query, queryRead } from '../../../../../../../../lib/db';
import { ensureActiveVacancyLinkToken } from '../../../../../../../../lib/recruiting/vacancy-link';
import { enqueueTransactionalMail } from '../../../../../../../../lib/mail';
import { buildCandidateChallengeInviteMail } from '../../../../../../../../lib/recruiting/candidate-challenge-invite-mail';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../../lib/rate-limit';
import { apiError, localeFromRequest, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/permissions';
import { publicAppUrl } from '../../../../../../../../lib/ae/require-admin';

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
    const inviteId = params?.inviteId;
    if (!vacancyId || !inviteId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const ip = clientIpFromRequest(request);
    const uid = payload?.userId ?? '';
    const rl = await checkRateLimit(`invite-remind:${uid || ip}`, 60, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_REMINDERS, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const inv = await queryRead(
      `SELECT ci.id, ci.candidate_id AS "candidateId", ci.company_id AS "inviteCompanyId", ci.token, ci.candidate_name AS "candidateName", CASE WHEN ci.candidate_id IS NULL THEN ci.candidate_email ELSE person.email END AS "candidateEmail",
              ci.status, ci.reminder_count AS "reminderCount",
              v.id AS "vacancyId", v.title AS "vacancyTitle", v.status AS "vacancyStatus", v.company_id AS "companyId",
              c.name AS "companyName"
       FROM candidate_invites ci
       LEFT JOIN candidates person ON person.id=ci.candidate_id AND person.company_id=ci.company_id
       JOIN vacancies v ON v.id = ci.vacancy_id AND v.deleted = FALSE
       JOIN companies c ON c.id = v.company_id AND c.deleted = FALSE
       WHERE ci.id = $1 AND ci.vacancy_id = $2
       LIMIT 1`,
      [inviteId, vacancyId]
    );
    if (inv.rowCount === 0) return apiError(request, ERR.INVITE_NOT_FOUND, 404);

    const row = inv.rows[0];
    if (!isAdmin && String(row.companyId) !== String(companyId)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    if (String(row.vacancyStatus || '') === 'closed') {
      return apiError(request, ERR.VACANCY_CLOSED, 400);
    }
    if (!['sent', 'opened'].includes(String(row.status || ''))) {
      return apiError(request, ERR.INVITE_NOT_PENDING, 400);
    }

    if (row.candidateId == null) {
      const contact = await candidateContact(queryRead, { companyId: row.inviteCompanyId, email: row.candidateEmail });
      if (contact) row.candidateEmail = contact.email;
    }
    if (!row.candidateEmail) return apiError(request, ERR.CANDIDATE_NO_EMAIL, 400);
    const base = publicAppUrl(request);
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const linkToken = await ensureActiveVacancyLinkToken(row.vacancyId);
    const challengeUrl = `${base}/v/${linkToken}?invite=${encodeURIComponent(row.token)}`;
    const locale = localeFromRequest(request);
    const { subject, text, html } = buildCandidateChallengeInviteMail({
      candidateFullName: row.candidateName,
      vacancyTitle: row.vacancyTitle,
      companyName: row.companyName ?? null,
      challengeUrl,
      locale,
    });

    try {
      enqueueTransactionalMail({ to: row.candidateEmail, subject, text, html });
    } catch (e) {
      if (e?.code === 'MAIL_NOT_CONFIGURED') {
        return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
      }
      console.error('remind mail error', e);
      return apiError(request, ERR.MAIL_FAILED, 502);
    }

    const up = await query(
      `UPDATE candidate_invites
       SET last_reminder_at = NOW(), reminder_count = reminder_count + 1
       WHERE id = $1
       RETURNING last_reminder_at AS "lastReminderAt", reminder_count AS "reminderCount"`,
      [inviteId]
    );

    return NextResponse.json({ ok: true, queued: true, ...up.rows[0] });
  } catch (e) {
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
