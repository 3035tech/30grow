import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../../lib/identity/auth';
import { verifySessionWithCapabilities } from '../../../../../../../../lib/identity/user-capabilities';
import { query, queryRead } from '../../../../../../../../lib/db.js';
import { apiError, localeFromRequest, ERR } from '../../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../../lib/identity/permissions';
import {
  draftScorecardItemsFromBrief,
  getInterviewScorecard,
  upsertInterviewScorecard,
} from '../../../../../../../../lib/people/interview-scorecard';
import { buildInterviewQuestions } from '../../../../../../../../lib/people/decision-brief';
import { isOpenAiConfigured } from '../../../../../../../../lib/openai-chat.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../../lib/identity/rate-limit.js';
import {
  generateInterviewGuideAi,
  summarizeInterviewScorecardAi,
  suggestInterviewFollowUpAi,
} from '../../../../../../../../lib/recruiting/interview-guide-ai.js';
import {
  motivatorDimensionLabel,
  motivatorWorkMeaning,
} from '../../../../../../../../lib/ae/motivators-dimensions.js';

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

async function loadInterviewProfileContext({ candidateId, companyId, locale }) {
  const [assessmentResult, motivatorResult] = await Promise.all([
    queryRead(
      `SELECT top_type AS "topType"
         FROM assessments
        WHERE candidate_id = $1 AND company_id = $2 AND top_type IS NOT NULL
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [candidateId, companyId]
    ).catch(() => ({ rows: [] })),
    queryRead(
      `SELECT dimension_scores AS "dimensionScores"
         FROM ae_attempts
        WHERE candidate_id = $1 AND company_id = $2
          AND status = 'completed' AND dimension_scores IS NOT NULL
        ORDER BY completed_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [candidateId, companyId]
    ).catch(() => ({ rows: [] })),
  ]);

  const rawTopType = Number(assessmentResult.rows?.[0]?.topType);
  const scores = motivatorResult.rows?.[0]?.dimensionScores;
  const motivators = scores && typeof scores === 'object' && !Array.isArray(scores)
    ? Object.entries(scores)
      .map(([key, score]) => ({ key, score: Number(score) || 0 }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ key }) => ({
        label: motivatorDimensionLabel(key, locale),
        workMeaning: motivatorWorkMeaning(key, locale),
      }))
    : [];
  const context = {
    workStyleType: Number.isInteger(rawTopType) && rawTopType >= 1 && rawTopType <= 9
      ? `T${rawTopType}`
      : null,
    motivators,
  };
  return context.workStyleType || context.motivators.length ? context : null;
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

/** POST /api/admin/vacancies/[id]/candidates/[candidateId]/scorecard — generate interview guidance. */
export async function POST(request, props) {
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
    if (!isOpenAiConfigured()) return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, 503);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`interview-guide-ai:${payload.userId || ip}`, 12, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    if (!['generateInterviewGuide', 'suggestInterviewFollowUp', 'summarizeInterviewScorecard'].includes(body.action)) {
      return apiError(request, ERR.INVALID_ACTION, 400);
    }

    const paramsForCandidate = [vacancyId, candidateId];
    let tenantClause = '';
    if (!scope.isAdmin) {
      tenantClause = 'AND v.company_id = $3';
      paramsForCandidate.push(scope.companyId);
    }
    const linked = await queryRead(
      `SELECT v.id, v.company_id AS "companyId", v.title, v.description,
              r.notes AS "rubricNotes",
              c.full_name AS "fullName",
              c.cv_extracted_text AS "cvExtractedText",
              c.professional_summary AS "professionalSummary"
         FROM vacancies v
         JOIN vacancy_candidates vc
           ON vc.vacancy_id = v.id AND vc.company_id = v.company_id
         JOIN candidates c
           ON c.id = vc.candidate_id AND c.company_id = v.company_id
         LEFT JOIN vacancy_rubrics r ON r.vacancy_id = v.id
        WHERE v.id = $1 AND vc.candidate_id = $2 AND v.deleted = FALSE ${tenantClause}
        LIMIT 1`,
      paramsForCandidate
    );
    const record = linked.rows[0];
    if (!record) return apiError(request, ERR.NOT_FOUND, 404);
    if (body.action === 'generateInterviewGuide' && !String(record.cvExtractedText || record.professionalSummary || '').trim()) {
      return apiError(request, ERR.CV_IMPORT_EMPTY, 422);
    }

    const locale = body.locale ? body.locale : localeFromRequest(request);
    if (body.action === 'summarizeInterviewScorecard') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 12) : [];
      if (!items.some((item) => String(item?.comment || '').trim().length >= 8)) {
        return apiError(request, ERR.INVALID_DATA, 422);
      }
      const out = await summarizeInterviewScorecardAi({
        vacancy: record,
        candidate: record,
        items,
        locale,
        usage: { companyId: record.companyId, userId: payload.userId },
      });
      return NextResponse.json({ ok: true, action: body.action, summary: out.summary, model: out.model });
    }

    const profileContext = body.includeProfileContext === true
      ? await loadInterviewProfileContext({ candidateId, companyId: record.companyId, locale })
      : null;
    if (body.action === 'suggestInterviewFollowUp') {
      const notes = String(body.notes || '').trim();
      const question = String(body.question || '').trim();
      if (notes.length < 8 || question.length < 8) return apiError(request, ERR.INVALID_DATA, 422);
      const out = await suggestInterviewFollowUpAi({
        vacancy: record,
        candidate: record,
        profileContext,
        question,
        notes,
        locale,
        usage: { companyId: record.companyId, userId: payload.userId },
      });
      return NextResponse.json({ ok: true, action: body.action, question: out.question, model: out.model });
    }

    const out = await generateInterviewGuideAi({
      vacancy: record,
      candidate: record,
      profileContext,
      locale,
      usage: { companyId: record.companyId, userId: payload.userId },
    });
    return NextResponse.json({
      ok: true,
      action: body.action,
      questions: out.questions,
      contextUsed: {
        vacancy: true,
        profileSummary: Boolean(String(record.professionalSummary || '').trim()),
        curriculum: Boolean(String(record.cvExtractedText || '').trim()),
        workStyle: Boolean(profileContext?.workStyleType),
        motivators: Boolean(profileContext?.motivators?.length),
      },
      model: out.model,
    });
  } catch (err) {
    const code = err?.code || 'INTERVIEW_GUIDE_AI_FAILED';
    if (
      code === 'INTERVIEW_GUIDE_AI_PARSE' ||
      code === 'INTERVIEW_FOLLOW_UP_AI_PARSE' ||
      code === 'INTERVIEW_SCORECARD_SUMMARY_AI_PARSE'
    ) {
      return apiError(request, ERR.ASSIST_AI_PARSE, 422);
    }
    if (code === 'INTERVIEW_FOLLOW_UP_NOTES_REQUIRED') {
      return apiError(request, ERR.INVALID_DATA, 422);
    }
    if (code === ERR.INVALID_DATA) return apiError(request, code, 422);
    if (code === ERR.CV_IMPORT_EMPTY) return apiError(request, code, 422);
    console.error('POST interview guide AI', err);
    return apiError(request, ERR.INTERNAL, 502);
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
