import { candidateContact } from '../../../../../../lib/recruiting/candidate-contact';
import crypto from 'crypto';
import { verifySessionWithCapabilities } from '../../../../../../lib/user-capabilities';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/auth';
import { query } from '../../../../../../lib/db';
import { ensureActiveVacancyLinkToken } from '../../../../../../lib/recruiting/vacancy-link';
import { enqueueTransactionalMail } from '../../../../../../lib/mail';
import { buildCandidateChallengeInviteMail } from '../../../../../../lib/recruiting/candidate-challenge-invite-mail';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit';
import { apiError, localeFromRequest, ERR } from '../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../lib/permissions';
import { publicAppUrl } from '../../../../../../lib/ae/require-admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const ip = clientIpFromRequest(request);
    const uid = payload?.userId ?? '';
    const rlKey = `invite:${uid || ip}`;
    const rl = await checkRateLimit(rlKey, 40, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_INVITES, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const candidateName = String(body.candidateName || body.name || '').trim();
    let candidateEmail = String(body.candidateEmail || body.email || '')
      .trim()
      .toLowerCase();

    if (!candidateName || candidateName.length > 200) {
      return apiError(request, ERR.CANDIDATE_NAME_REQUIRED, 400);
    }
    if (!candidateEmail || !EMAIL_RE.test(candidateEmail)) {
      return apiError(request, ERR.INVALID_CANDIDATE_EMAIL, 400);
    }

    let row;
    if (!isAdmin) {
      const owned = await query(
        `SELECT v.id, v.company_id AS "companyId", v.title, v.status, c.name AS "companyName"
         FROM vacancies v
         JOIN companies c ON c.id = v.company_id
         WHERE v.id = $1 AND v.company_id = $2 AND v.deleted = FALSE AND c.deleted = FALSE
         LIMIT 1`,
        [vacancyId, companyId]
      );
      if (owned.rowCount === 0) return apiError(request, ERR.UNAUTHORIZED, 401);
      row = owned.rows[0];
    } else {
      const exists = await query(
        `SELECT v.id, v.company_id AS "companyId", v.title, v.status, c.name AS "companyName"
         FROM vacancies v
         JOIN companies c ON c.id = v.company_id
         WHERE v.id = $1 AND v.deleted = FALSE AND c.deleted = FALSE
         LIMIT 1`,
        [vacancyId]
      );
      if (exists.rowCount === 0) return apiError(request, ERR.VACANCY_NOT_FOUND, 404);
      row = exists.rows[0];
    }

    if (String(row.status || '') === 'closed') {
      return apiError(request, ERR.VACANCY_CLOSED, 400);
    }

    const contact = await candidateContact(query, { companyId: row.companyId, email: candidateEmail });
    if (contact) candidateEmail = contact.email;
    if (!candidateEmail) return apiError(request, ERR.CANDIDATE_NO_EMAIL, 400);
    const base = publicAppUrl(request);
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const linkToken = await ensureActiveVacancyLinkToken(row.id);
    const inviteToken = crypto.randomBytes(24).toString('hex');
    const createdBy = payload?.userId != null ? Number(payload.userId) : null;
    const createdBySql = Number.isFinite(createdBy) ? createdBy : null;

    const ins = await query(
      `INSERT INTO candidate_invites (
         vacancy_id, company_id, candidate_name, candidate_email, token, status, created_by_user_id, expires_at, candidate_id
       ) VALUES ($1, $2, $3, $4, $5, 'sent', $6, NOW() + INTERVAL '30 days', $7)
       RETURNING id`,
      [row.id, row.companyId, candidateName, candidateEmail, inviteToken, createdBySql, contact?.id ?? null]
    );
    const inviteId = ins.rows[0]?.id;
    const challengeUrl = `${base}/v/${linkToken}?invite=${encodeURIComponent(inviteToken)}`;

    const locale = localeFromRequest(request);
    const { subject, text, html } = buildCandidateChallengeInviteMail({
      candidateFullName: candidateName,
      vacancyTitle: row.title,
      companyName: row.companyName ?? null,
      challengeUrl,
      locale,
    });

    try {
      enqueueTransactionalMail({ to: candidateEmail, subject, text, html });
    } catch (e) {
      if (inviteId != null) {
        await query(`DELETE FROM candidate_invites WHERE id = $1`, [inviteId]).catch(() => {});
      }
      if (e?.code === 'MAIL_NOT_CONFIGURED') {
        return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
      }
      console.error('invite mail error', e);
      return apiError(request, ERR.MAIL_FAILED, 502);
    }

    return NextResponse.json({ ok: true, sentTo: candidateEmail, inviteId, queued: true });
  } catch (error) {
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
