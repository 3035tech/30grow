/**
 * Create Motivators (AE) invite + queue email.
 * Shared by /api/admin/ae/invites and vacancy candidate invite.
 */

import crypto from 'crypto';
import { candidateContact } from '../candidate-contact.js';
import { enqueueTransactionalMail } from '../mail.js';
import { buildMotivatorsInviteMail } from '../motivators-invite-mail.js';
import { bootstrapMotivators } from './bootstrap-motivators.js';
import { ERR } from '../api-error-codes.js';

const INVITE_TTL_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidInviteEmail(email) {
  return Boolean(email && EMAIL_RE.test(String(email).trim()));
}

/**
 * @param {Function} dbQuery - lib/db query
 * @param {{
 *   companyId: number,
 *   candidateName: string,
 *   candidateEmail: string,
 *   candidateId?: number|null,
 *   createdByUserId?: number|null,
 *   definitionSlug?: string,
 *   locale?: string,
 *   appBaseUrl: string,
 * }} opts
 */
export async function createAndQueueMotivatorsInvite(dbQuery, opts) {
  const companyId = Number(opts.companyId);
  const candidateName = String(opts.candidateName || '').trim();
  let candidateEmail = String(opts.candidateEmail || '').trim().toLowerCase();
  const definitionSlug = String(opts.definitionSlug || 'motivators').trim();
  const appBaseUrl = String(opts.appBaseUrl || '').replace(/\/$/, '');
  const locale = opts.locale || 'pt-BR';
  let candidateId =
    opts.candidateId != null && Number.isFinite(Number(opts.candidateId))
      ? Number(opts.candidateId)
      : null;
  const createdBy =
    opts.createdByUserId != null && Number.isFinite(Number(opts.createdByUserId))
      ? Number(opts.createdByUserId)
      : null;

  if (!Number.isFinite(companyId)) {
    return { ok: false, errorCode: ERR.INVALID_COMPANY, status: 400 };
  }
  if (!candidateName || candidateName.length > 200) {
    return { ok: false, errorCode: ERR.CANDIDATE_NAME_REQUIRED, status: 400 };
  }
  const contact = await candidateContact(dbQuery, { companyId, candidateId, email: candidateEmail });
  if (candidateId != null && !contact) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND, status: 404 };
  if (contact) { candidateEmail = contact.email; candidateId = contact.id; }
  if (!isValidInviteEmail(candidateEmail)) {
    return { ok: false, errorCode: ERR.INVALID_EMAIL, status: 400 };
  }
  if (!appBaseUrl) {
    return { ok: false, errorCode: ERR.APP_URL_MISSING, status: 500 };
  }

  const companyRes = await dbQuery(
    `SELECT id, name AS "companyName" FROM companies WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  if (companyRes.rowCount === 0) {
    return { ok: false, errorCode: ERR.COMPANY_NOT_FOUND_OR_INACTIVE, status: 404 };
  }

  let defRes = await dbQuery(
    `SELECT id FROM ae_definitions WHERE LOWER(slug) = LOWER($1) AND active = TRUE LIMIT 1`,
    [definitionSlug]
  );

  if (defRes.rowCount === 0) {
    try {
      await bootstrapMotivators(dbQuery);
      defRes = await dbQuery(
        `SELECT id FROM ae_definitions WHERE LOWER(slug) = LOWER($1) AND active = TRUE LIMIT 1`,
        [definitionSlug]
      );
    } catch (bootstrapErr) {
      if (bootstrapErr?.code === '42P01') {
        return { ok: false, errorCode: ERR.MOTIVATORS_SCHEMA_MISSING, status: 503 };
      }
      throw bootstrapErr;
    }
  }

  if (defRes.rowCount === 0) {
    return { ok: false, errorCode: ERR.MOTIVATORS_NOT_CONFIGURED, status: 503 };
  }

  const inviteToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const ins = await dbQuery(
    `INSERT INTO ae_invites (
       definition_id, company_id, candidate_id, candidate_name, candidate_email, token,
       status, expires_at, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7, $8)
     RETURNING id`,
    [
      defRes.rows[0].id,
      companyId,
      candidateId,
      candidateName,
      candidateEmail,
      inviteToken,
      expiresAt,
      createdBy,
    ]
  );
  const inviteId = ins.rows[0].id;
  const assessmentUrl = `${appBaseUrl}/assessment/motivators/${inviteToken}`;

  const { subject, text, html } = buildMotivatorsInviteMail({
    candidateFullName: candidateName,
    companyName: companyRes.rows[0].companyName,
    assessmentUrl,
    locale,
  });

  try {
    enqueueTransactionalMail({ to: candidateEmail, subject, text, html });
  } catch (e) {
    await dbQuery(`DELETE FROM ae_invites WHERE id = $1`, [inviteId]).catch(() => {});
    if (e?.code === 'MAIL_NOT_CONFIGURED') {
      return { ok: false, errorCode: ERR.SMTP_NOT_CONFIGURED, status: 503 };
    }
    return { ok: false, errorCode: ERR.MAIL_FAILED, status: 502 };
  }

  try {
    const { notifyCandidate, EMPLOYEE_NOTIF } = await import('../employee-notifications.js');
    await notifyCandidate(dbQuery, {
      companyId,
      candidateId,
      type: EMPLOYEE_NOTIF.MOTIVATORS_INVITE,
      entityType: 'ae_invite',
      entityId: inviteId,
      dedupeKey: `motivators_invite:${inviteId}`,
      payload: { assessmentUrl, inviteId },
    });
  } catch {
    /* optional — schema may lag */
  }

  return {
    ok: true,
    inviteId,
    sentTo: candidateEmail,
    assessmentUrl,
    queued: true,
  };
}
