import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db';
import { apiError, localeFromRequest, ERR } from '../../../../lib/api-error';
import { t } from '../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';

/** GET /api/public/ae-invite?token= — valida convite de motivadores. */
export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-ae-invite:${ip}`, 60, 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const { searchParams } = new URL(request.url);
    const token = String(searchParams.get('token') || '').trim();
    if (!token) {
      return apiError(request, ERR.INVALID_TOKEN, 400);
    }

    const res = await queryRead(
      `SELECT i.id, i.candidate_name AS "candidateName", CASE WHEN i.candidate_id IS NULL THEN i.candidate_email ELSE cand.email END AS "candidateEmail",
              i.candidate_id AS "candidateId", i.company_id AS "companyId",
              i.status, i.expires_at AS "expiresAt",
              d.slug AS "definitionSlug", d.name AS "definitionName",
              c.name AS "companyName",
              cand.phone AS "candPhone",
              cand.linkedin_url AS "candLinkedin",
              cand.city AS "candCity",
              cand.state AS "candState"
       FROM ae_invites i
       JOIN ae_definitions d ON d.id = i.definition_id
       JOIN companies c ON c.id = i.company_id
       LEFT JOIN candidates cand ON cand.id = i.candidate_id AND cand.company_id = i.company_id
       WHERE i.token = $1 AND c.deleted = FALSE AND d.active = TRUE
       LIMIT 1`,
      [token]
    );

    if (res.rowCount === 0) {
      return apiError(request, ERR.INVITE_NOT_FOUND, 404);
    }

    const row = res.rows[0];
    if (new Date(row.expiresAt) < new Date()) {
      return apiError(request, ERR.INVITE_EXPIRED, 403);
    }
    if (row.status === 'cancelled') {
      return apiError(request, ERR.INVITE_CANCELLED, 403);
    }
    if (row.status === 'completed') {
      const locale = localeFromRequest(request);
      return NextResponse.json(
        {
          errorCode: ERR.INVITE_COMPLETED,
          error: t(locale, 'errors.INVITE_COMPLETED'),
          completed: true,
        },
        { status: 409 }
      );
    }

    let phone = row.candPhone || null;
    let linkedinUrl = row.candLinkedin || null;
    let city = row.candCity || null;
    let state = row.candState || null;

    if (!row.candidateId && row.candidateEmail && row.companyId) {
      const byEmail = await queryRead(
        `SELECT phone, linkedin_url AS "linkedinUrl", city, state
         FROM candidates
         WHERE company_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
         LIMIT 1`,
        [row.companyId, row.candidateEmail]
      );
      if (byEmail.rowCount > 0) {
        phone = byEmail.rows[0].phone || phone;
        linkedinUrl = byEmail.rows[0].linkedinUrl || linkedinUrl;
        city = byEmail.rows[0].city || city;
        state = byEmail.rows[0].state || state;
      }
    }

    const hasHrProfile = Boolean(
      (phone && String(phone).trim()) ||
        (linkedinUrl && String(linkedinUrl).trim()) ||
        (city && String(city).trim()) ||
        (state && String(state).trim())
    );

    return NextResponse.json({
      ok: true,
      inviteId: row.id,
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      status: row.status,
      definitionSlug: row.definitionSlug,
      definitionName: row.definitionName,
      companyName: row.companyName,
      expiresAt: row.expiresAt,
      hasHrProfile,
    });
  } catch (err) {
    console.error('GET /api/public/ae-invite', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
