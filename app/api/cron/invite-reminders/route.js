import { NextResponse } from 'next/server';
import { query, queryRead } from '../../../../lib/db';

export const dynamic = 'force-dynamic';
import { ensureActiveVacancyLinkToken } from '../../../../lib/vacancy-link';
import { sendTransactionalMail } from '../../../../lib/mail';
import { buildCandidateChallengeInviteMail } from '../../../../lib/candidate-challenge-invite-mail';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/cron-auth';

function publicAppUrlFromEnv() {
  const env = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  return env ? env.replace(/\/$/, '') : '';
}

/**
 * POST — processa lembretes pendentes (cron externo).
 * Requer CRON_SECRET e header Authorization: Bearer <CRON_SECRET> ou X-Cron-Secret.
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const base = publicAppUrlFromEnv();
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const pending = await queryRead(
      `SELECT ci.id, ci.token, ci.candidate_name AS "candidateName", ci.candidate_email AS "candidateEmail",
              ci.reminder_count AS "reminderCount", ci.sent_at AS "sentAt", ci.last_reminder_at AS "lastReminderAt",
              v.id AS "vacancyId", v.title AS "vacancyTitle", v.status AS "vacancyStatus",
              c.name AS "companyName"
       FROM candidate_invites ci
       JOIN vacancies v ON v.id = ci.vacancy_id AND v.deleted = FALSE AND v.status = 'open'
       JOIN companies c ON c.id = v.company_id AND c.deleted = FALSE
       WHERE ci.status IN ('sent', 'opened')
         AND ci.expires_at > NOW()
         AND ci.reminder_count < 5
         AND ci.sent_at < NOW() - INTERVAL '2 days'
         AND (ci.last_reminder_at IS NULL OR ci.last_reminder_at < NOW() - INTERVAL '3 days')
       ORDER BY ci.sent_at ASC
       LIMIT 40`
    );

    let sent = 0;
    const errors = [];

    for (const row of pending.rows) {
      try {
        const linkToken = await ensureActiveVacancyLinkToken(row.vacancyId);
        const challengeUrl = `${base}/v/${linkToken}?invite=${encodeURIComponent(row.token)}`;
        const { subject, text, html } = buildCandidateChallengeInviteMail({
          candidateFullName: row.candidateName,
          vacancyTitle: row.vacancyTitle,
          companyName: row.companyName ?? null,
          challengeUrl,
        });
        await sendTransactionalMail({ to: row.candidateEmail, subject, text, html });
        await query(
          `UPDATE candidate_invites SET last_reminder_at = NOW(), reminder_count = reminder_count + 1 WHERE id = $1`,
          [row.id]
        );
        sent += 1;
      } catch (e) {
        errors.push({ inviteId: row.id, message: e?.message || String(e) });
        if (e?.code === 'MAIL_NOT_CONFIGURED') break;
      }
    }

    return NextResponse.json({ ok: true, processed: pending.rows.length, sent, errors });
  } catch (e) {
    console.error('cron invite-reminders', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
