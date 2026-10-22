import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/auth';
import { query } from '../../../../../../../../lib/db';
import { createAndQueueMotivatorsInvite } from '../../../../../../../../lib/ae/create-motivators-invite';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../../lib/rate-limit';
import { apiError, localeFromRequest, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/permissions';
import { publicAppUrl } from '../../../../../../../../lib/ae/require-admin';

/**
 * POST — envia convite de Motivadores para candidato já pré-cadastrado na vaga.
 * Auth: VACANCIES_MANAGE (mesmo fluxo da listagem de candidatos da vaga).
 */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const ip = clientIpFromRequest(request);
    const uid = payload?.userId ?? '';
    const rl = await checkRateLimit(`ae-invite-vacancy:${uid || ip}`, 40, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_INVITES, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const link = await query(
      `SELECT vc.id, vc.company_id AS "companyId",
              c.full_name AS "fullName", c.email,
              v.id AS "vacancyId", v.status
       FROM vacancy_candidates vc
       JOIN candidates c ON c.id = vc.candidate_id
       JOIN vacancies v ON v.id = vc.vacancy_id
       JOIN companies co ON co.id = v.company_id
       WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2
         AND v.deleted = FALSE AND co.deleted = FALSE
       LIMIT 1`,
      [vacancyId, candidateId]
    );
    if (link.rowCount === 0) return apiError(request, ERR.CANDIDATE_NOT_FOUND, 404);
    const row = link.rows[0];
    if (!isAdmin && String(row.companyId) !== String(companyId)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    if (!row.email) {
      return apiError(request, ERR.CANDIDATE_NO_EMAIL, 400);
    }
    if (String(row.status || '') === 'closed') {
      return apiError(request, ERR.VACANCY_CLOSED, 400);
    }

    const already = await query(
      `SELECT a.id
       FROM ae_attempts a
       JOIN ae_definitions d ON d.id = a.definition_id AND LOWER(d.slug) = 'motivators'
       WHERE a.company_id = $1
         AND a.candidate_id = $2
         AND a.status = 'completed'
       LIMIT 1`,
      [row.companyId, candidateId]
    );
    if (already.rowCount > 0) {
      return apiError(request, ERR.MOTIVATORS_ALREADY_ANSWERED, 409);
    }

    const base = publicAppUrl(request);
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const result = await createAndQueueMotivatorsInvite(query, {
      companyId: row.companyId,
      candidateName: String(row.fullName || '').trim(),
      candidateEmail: String(row.email).trim().toLowerCase(),
      candidateId: Number(candidateId),
      createdByUserId: payload?.userId,
      locale: localeFromRequest(request),
      appBaseUrl: base,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode, result.status || 400);
    }

    return NextResponse.json({
      ok: true,
      inviteId: result.inviteId,
      sentTo: result.sentTo,
      assessmentUrl: result.assessmentUrl,
      queued: true,
    });
  } catch (err) {
    console.error('POST vacancy candidate motivators invite', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
