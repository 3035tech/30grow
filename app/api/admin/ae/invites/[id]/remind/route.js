import { candidateContact } from '../../../../../../../lib/candidate-contact';
import { NextResponse } from 'next/server';
import { query } from '../../../../../../../lib/db';
import { CAP, getManagerScope, getSessionPayload, publicAppUrl, requireCapability } from '../../../../../../../lib/ae/require-admin';
import { enqueueTransactionalMail } from '../../../../../../../lib/mail';
import { buildMotivatorsInviteMail } from '../../../../../../../lib/motivators-invite-mail';
import { apiError, localeFromRequest, ERR } from '../../../../../../../lib/api-error';

async function loadInvite(id, { isAdmin, companyId }) {
  const params = [id];
  let scope = '';
  if (!isAdmin) {
    scope = 'AND i.company_id = $2';
    params.push(companyId);
  }
  const res = await query(
    `SELECT i.id, i.candidate_id AS "candidateId", i.company_id AS "inviteCompanyId", i.candidate_name AS "candidateName", CASE WHEN i.candidate_id IS NULL THEN i.candidate_email ELSE person.email END AS "candidateEmail",
            i.token, i.status, c.name AS "companyName"
     FROM ae_invites i
     LEFT JOIN candidates person ON person.id=i.candidate_id AND person.company_id=i.company_id
     JOIN companies c ON c.id = i.company_id
     WHERE i.id = $1 ${scope}
     LIMIT 1`,
    params
  );
  return res.rowCount > 0 ? res.rows[0] : null;
}

/** POST /api/admin/ae/invites/[id]/remind */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.MOTIVATORS_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const invite = await loadInvite(params.id, scope);
    if (!invite) return apiError(request, ERR.INVITE_NOT_FOUND, 404);
    if (!['sent', 'opened'].includes(invite.status)) {
      return apiError(request, ERR.INVITE_NOT_PENDING, 400);
    }

    if (invite.candidateId == null) {
      const contact = await candidateContact(query, { companyId: invite.inviteCompanyId, email: invite.candidateEmail });
      if (contact) invite.candidateEmail = contact.email;
    }
    if (!invite.candidateEmail) return apiError(request, ERR.CANDIDATE_NO_EMAIL, 400);
    const base = publicAppUrl(request);
    if (!base) return apiError(request, ERR.APP_URL_MISSING, 500);

    const assessmentUrl = `${base}/assessment/motivators/${invite.token}`;
    const locale = localeFromRequest(request);
    const { subject, text, html } = buildMotivatorsInviteMail({
      candidateFullName: invite.candidateName,
      companyName: invite.companyName,
      assessmentUrl,
      locale,
    });

    try {
      enqueueTransactionalMail({ to: invite.candidateEmail, subject, text, html });
    } catch (err) {
      if (err?.code === 'MAIL_NOT_CONFIGURED') {
        return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
      }
      console.error('POST /api/admin/ae/invites/[id]/remind', err);
      return apiError(request, ERR.MAIL_FAILED, 502);
    }
    await query(
      `UPDATE ae_invites SET last_reminder_at = NOW(), reminder_count = reminder_count + 1 WHERE id = $1`,
      [invite.id]
    );
    return NextResponse.json({ ok: true, queued: true });
  } catch (err) {
    console.error('POST /api/admin/ae/invites/[id]/remind', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
