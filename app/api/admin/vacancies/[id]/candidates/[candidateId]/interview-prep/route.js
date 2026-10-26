import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../../lib/admin-api.js';
import { CAP, isSuperAdminPayload } from '../../../../../../../../lib/permissions.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../../../lib/api-error.js';
import {
  ensureInterviewPrepLink,
  getInterviewPrepStatus,
} from '../../../../../../../../lib/recruiting/interview-prep.js';
import { query } from '../../../../../../../../lib/db.js';

export const dynamic = 'force-dynamic';

async function assertVacancyCandidate(companyId, vacancyId, candidateId, isAdmin) {
  const params = [vacancyId, candidateId];
  let companyClause = '';
  if (!isAdmin) {
    params.push(companyId);
    companyClause = 'AND vc.company_id = $3';
  }
  const r = await query(
    `SELECT vc.company_id AS "companyId"
     FROM vacancy_candidates vc
     JOIN vacancies v ON v.id = vc.vacancy_id AND v.deleted = FALSE
     WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2 ${companyClause}
     LIMIT 1`,
    params
  );
  return r.rows[0] || null;
}

/** GET /api/admin/vacancies/[id]/candidates/[candidateId]/interview-prep */
export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    requireCompany: false,
    companyFrom: 'none',
    logLabel: 'interview-prep GET',
  },
  async ({ request, payload, params }) => {
    const vacancyId = Number(params?.id);
    const candidateId = Number(params?.candidateId);
    const row = await assertVacancyCandidate(
      payload.companyId,
      vacancyId,
      candidateId,
      isSuperAdminPayload(payload)
    );
    if (!row) {
      return apiError(request, ERR.NOT_FOUND, httpStatusForError(ERR.NOT_FOUND));
    }
    const result = await getInterviewPrepStatus(null, {
      companyId: row.companyId,
      vacancyId,
      candidateId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result);
  }
);

/** POST — create or return prep link */
export const POST = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    requireCompany: false,
    companyFrom: 'none',
    logLabel: 'interview-prep POST',
  },
  async ({ request, payload, params }) => {
    const vacancyId = Number(params?.id);
    const candidateId = Number(params?.candidateId);
    const row = await assertVacancyCandidate(
      payload.companyId,
      vacancyId,
      candidateId,
      isSuperAdminPayload(payload)
    );
    if (!row) {
      return apiError(request, ERR.NOT_FOUND, httpStatusForError(ERR.NOT_FOUND));
    }
    const result = await ensureInterviewPrepLink(null, {
      companyId: row.companyId,
      vacancyId,
      candidateId,
      createdByUserId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  }
);
