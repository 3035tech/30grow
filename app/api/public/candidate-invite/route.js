import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

export const dynamic = 'force-dynamic';

/** GET /api/public/candidate-invite?token=&vacancyToken= — identity for Enneagram email invites. */
export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-candidate-invite:${ip}`, 60, 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const { searchParams } = new URL(request.url);
    const token = String(searchParams.get('token') || '').trim();
    const vacancyToken = String(searchParams.get('vacancyToken') || '').trim();
    if (!token) return apiError(request, ERR.INVALID_TOKEN, 400);

    const res = await queryRead(
      `SELECT
         ci.id,
         ci.company_id AS "companyId",
         ci.candidate_id AS "candidateId",
         ci.candidate_name AS "candidateName",
         CASE WHEN ci.candidate_id IS NULL THEN ci.candidate_email ELSE cand.email END AS "candidateEmail",
         ci.status,
         ci.expires_at AS "expiresAt",
         ci.vacancy_id AS "vacancyId",
         v.title AS "vacancyTitle",
         co.name AS "companyName",
         cand.phone,
         cand.linkedin_url AS "linkedinUrl",
         cand.city,
         cand.state
       FROM candidate_invites ci
       JOIN vacancies v ON v.id = ci.vacancy_id
       JOIN companies co ON co.id = ci.company_id
       LEFT JOIN candidates cand ON cand.id = ci.candidate_id AND cand.company_id = ci.company_id
       WHERE ci.token = $1
         AND v.deleted = FALSE
         AND co.deleted = FALSE
       LIMIT 1`,
      [token]
    );

    if (res.rowCount === 0) return apiError(request, ERR.INVITE_NOT_FOUND, 404);

    const row = res.rows[0];
    if (row.status === 'cancelled') return apiError(request, ERR.INVITE_CANCELLED, 403);
    if (row.status === 'completed') return apiError(request, ERR.INVITE_COMPLETED, 409);
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      return apiError(request, ERR.INVITE_EXPIRED, 403);
    }

    let vacancyTokenOk = false;
    if (vacancyToken) {
      const vac = await queryRead(
        `SELECT v.id
         FROM vacancy_links l
         JOIN vacancies v ON v.id = l.vacancy_id
         WHERE l.token = $1
           AND l.active = TRUE
           AND l.expires_at > NOW()
           AND v.deleted = FALSE
         LIMIT 1`,
        [vacancyToken]
      );
      if (vac.rowCount === 0) return apiError(request, ERR.EXPIRED_LINK, 403);
      if (Number(vac.rows[0].id) !== Number(row.vacancyId)) {
        return apiError(request, ERR.INVITE_VACANCY_MISMATCH, 400);
      }
      vacancyTokenOk = true;
    }

    const base = {
      ok: true,
      inviteId: row.id,
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      status: row.status,
      vacancyTitle: row.vacancyTitle,
      companyName: row.companyName,
    };

    // Perfil ampliado só com vacancyToken válido (reduz PII se o link vazar sozinho).
    if (!vacancyTokenOk) {
      return NextResponse.json({
        ...base,
        phone: '',
        linkedinUrl: '',
        city: '',
        state: '',
      });
    }

    let phone = row.phone || null;
    let linkedinUrl = row.linkedinUrl || null;
    let city = row.city || null;
    let state = row.state || null;

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
        phone = byEmail.rows[0].phone || null;
        linkedinUrl = byEmail.rows[0].linkedinUrl || null;
        city = byEmail.rows[0].city || null;
        state = byEmail.rows[0].state || null;
      }
    }

    return NextResponse.json({
      ...base,
      phone: phone || '',
      linkedinUrl: linkedinUrl || '',
      city: city || '',
      state: state || '',
    });
  } catch (e) {
    console.error('GET /api/public/candidate-invite', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
