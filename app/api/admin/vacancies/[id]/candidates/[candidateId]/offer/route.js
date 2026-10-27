import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/identity/auth';
import { query, queryRead } from '../../../../../../../../lib/db';
import { apiError, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/identity/permissions';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/identity/user-capabilities';
import { updateCandidateOffer, mapOffer } from '../../../../../../../../lib/people/candidate-offer';
import { audit } from '../../../../../../../../lib/audit';

async function loadScope(request, vacancyId, candidateId, payload) {
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };

  const r = await queryRead(
    `SELECT vc.id, vc.company_id AS "companyId",
            vc.offer_salary AS "offerSalary",
            vc.offer_start_date AS "offerStartDate",
            vc.offer_status AS "offerStatus",
            vc.offer_accepted_at AS "offerAcceptedAt",
            vc.offer_notes AS "offerNotes",
            ass.id AS "assessmentId"
     FROM vacancy_candidates vc
     JOIN vacancies v ON v.id = vc.vacancy_id AND v.deleted = FALSE
     LEFT JOIN LATERAL (
       SELECT a.id
       FROM assessments a
       WHERE a.vacancy_id = vc.vacancy_id AND a.candidate_id = vc.candidate_id
       ORDER BY a.created_at DESC
       LIMIT 1
     ) ass ON TRUE
     WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2
     LIMIT 1`,
    [vacancyId, candidateId]
  );
  if (r.rowCount === 0) {
    const assOnly = await queryRead(
      `SELECT ass.id AS "assessmentId", ass.company_id AS "companyId",
              ass.offer_salary AS "offerSalary",
              ass.offer_start_date AS "offerStartDate",
              ass.offer_status AS "offerStatus",
              ass.offer_accepted_at AS "offerAcceptedAt",
              ass.offer_notes AS "offerNotes"
       FROM assessments ass
       JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE
       WHERE ass.vacancy_id = $1 AND ass.candidate_id = $2
       ${!isAdmin ? 'AND ass.company_id = $3' : ''}
       ORDER BY ass.created_at DESC
       LIMIT 1`,
      !isAdmin ? [vacancyId, candidateId, companyId] : [vacancyId, candidateId]
    );
    if (assOnly.rowCount === 0) return { error: apiError(request, ERR.NOT_FOUND, 404) };
    const row = assOnly.rows[0];
    if (!isAdmin && String(row.companyId) !== String(companyId)) {
      return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
    }
    return { link: { ...row, hasVacancyCandidate: false } };
  }
  const row = r.rows[0];
  if (!isAdmin && String(row.companyId) !== String(companyId)) {
    return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  }
  return { link: { ...row, hasVacancyCandidate: true } };
}

/** GET /api/admin/vacancies/[id]/candidates/[candidateId]/offer */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const token = await (await cookies()).get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(token);
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const loaded = await loadScope(request, vacancyId, candidateId, payload);
    if (loaded.error) return loaded.error;

    return NextResponse.json({
      offer: mapOffer(loaded.link),
      assessmentId: loaded.link.assessmentId || null,
    });
  } catch (err) {
    console.error('GET offer', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/admin/vacancies/[id]/candidates/[candidateId]/offer */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const token = await (await cookies()).get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(token);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const loaded = await loadScope(request, vacancyId, candidateId, payload);
    if (loaded.error) return loaded.error;

    const body = await request.json().catch(() => ({}));
    const result = await updateCandidateOffer(query, {
      companyId: loaded.link.companyId,
      vacancyId: Number(vacancyId),
      candidateId: Number(candidateId),
      assessmentId: loaded.link.assessmentId || body.assessmentId || null,
      offerSalary: body.offerSalary,
      offerStartDate: body.offerStartDate,
      offerStatus: body.offerStatus,
      offerNotes: body.offerNotes,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode || 'INVALID_DATA', 400);
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'vacancy_candidate.offer_update',
      targetType: 'candidate',
      targetId: String(candidateId),
      metadata: {
        vacancyId: Number(vacancyId),
        offerStatus: result.offer?.offerStatus,
      },
    }).catch(() => {});

    return NextResponse.json({ offer: result.offer });
  } catch (err) {
    console.error('PATCH offer', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
