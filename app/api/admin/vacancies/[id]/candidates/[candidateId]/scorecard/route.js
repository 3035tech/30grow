import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/auth';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/user-capabilities';
import { query } from '../../../../../../../../lib/db';
import { apiError, localeFromRequest, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/permissions';
import {
  draftScorecardItemsFromBrief,
  getInterviewScorecard,
  upsertInterviewScorecard,
} from '../../../../../../../../lib/people/interview-scorecard';
import { buildInterviewQuestions } from '../../../../../../../../lib/people/decision-brief';

async function loadVacancyScope(request, vacancyId, payload) {
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  const params = [vacancyId];
  let sql = `SELECT id, company_id AS "companyId" FROM vacancies WHERE id = $1 AND deleted = FALSE`;
  if (!isAdmin) {
    sql += ` AND company_id = $2`;
    params.push(companyId);
  }
  const res = await query(`${sql} LIMIT 1`, params);
  if (!res.rowCount) return { error: apiError(request, ERR.VACANCY_NOT_FOUND, 404) };
  return { vacancy: res.rows[0], isAdmin, companyId };
}

/** GET /api/admin/vacancies/[id]/candidates/[candidateId]/scorecard */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_DATA, 400);

    const scope = await loadVacancyScope(request, vacancyId, payload);
    if (scope.error) return scope.error;

    const locale = localeFromRequest(request);
    const got = await getInterviewScorecard(query, {
      vacancyId,
      candidateId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
    });
    if (!got.ok) return apiError(request, got.errorCode || 'INTERNAL', got.status || 400);

    let items = got.scorecard?.items || [];
    if (!items.length) {
      const ass = await query(
        `SELECT a.top_type AS "topType"
         FROM assessments a
         WHERE a.candidate_id = $1 AND a.vacancy_id = $2
         ORDER BY a.created_at DESC NULLS LAST
         LIMIT 1`,
        [candidateId, vacancyId]
      );
      items = draftScorecardItemsFromBrief(
        {
          interviewQuestions: buildInterviewQuestions({
            locale,
            topType: ass.rows[0]?.topType,
          }),
        },
        locale
      );
    }

    return NextResponse.json({
      scorecard: got.scorecard
        ? { ...got.scorecard, items }
        : {
            vacancyId: Number(vacancyId),
            candidateId: Number(candidateId),
            items,
            draft: true,
          },
    });
  } catch (err) {
    console.error('GET scorecard', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PUT /api/admin/vacancies/[id]/candidates/[candidateId]/scorecard */
export async function PUT(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_DATA, 400);

    const scope = await loadVacancyScope(request, vacancyId, payload);
    if (scope.error) return scope.error;

    const body = await request.json().catch(() => ({}));
    const saved = await upsertInterviewScorecard(query, {
      vacancyId,
      candidateId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      items: body.items,
      createdByUserId: payload?.userId,
    });
    if (!saved.ok) return apiError(request, saved.errorCode || 'INTERNAL', saved.status || 400);
    return NextResponse.json({ scorecard: saved.scorecard });
  } catch (err) {
    console.error('PUT scorecard', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
