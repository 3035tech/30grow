import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/auth';
import {
  CAP,
  getManagerScope,
  requireCapability,
  verifySessionWithCapabilities,
} from '../../../../../../lib/ae/require-admin';
import { apiError, ERR, httpStatusForError } from '../../../../../../lib/api-error';
import { queryRead } from '../../../../../../lib/db';
import { isOpenAiConfigured } from '../../../../../../lib/openai-chat';
import { normalizeLocale } from '../../../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit';
import {
  suggestCandidateFieldsAi,
  suggestExecutiveNoteAi,
  suggestShortlistAi,
  suggestVacancyDescriptionAi,
  summarizeInterviewNotesAi,
} from '../../../../../../lib/vacancy-assist-ai';

async function loadVacancyScoped(vacancyId, { isAdmin, companyId }) {
  const r = await queryRead(
    `SELECT
       v.id,
       v.company_id AS "companyId",
       v.title,
       v.description,
       v.salary_min AS "salaryMin",
       v.salary_max AS "salaryMax",
       v.target_date AS "targetDate",
       v.employment_type AS "employmentType",
       r.notes AS "rubricNotes"
     FROM vacancies v
     LEFT JOIN vacancy_rubrics r ON r.vacancy_id = v.id
     WHERE v.id = $1 AND v.deleted = FALSE
       ${!isAdmin ? 'AND v.company_id = $2' : ''}
     LIMIT 1`,
    !isAdmin ? [vacancyId, companyId] : [vacancyId]
  );
  return r.rows[0] || null;
}

async function enrichCandidatesWithNotes(vacancyId, candidates, { isAdmin, companyId }) {
  const ids = [...new Set(
    (Array.isArray(candidates) ? candidates : [])
      .map((c) => Number(c.candidateId ?? c.id))
      .filter((n) => Number.isFinite(n))
  )].slice(0, 12);
  if (!ids.length) return candidates || [];

  const notes = await queryRead(
    `SELECT candidate_id AS "candidateId", interview_notes AS "interviewNotes"
     FROM vacancy_candidates
     WHERE vacancy_id = $1
       AND candidate_id = ANY($2::bigint[])
       ${!isAdmin ? 'AND company_id = $3' : ''}`,
    !isAdmin ? [vacancyId, ids, companyId] : [vacancyId, ids]
  );
  const byId = new Map(notes.rows.map((r) => [Number(r.candidateId), r.interviewNotes || '']));
  return (candidates || []).map((c) => {
    const id = Number(c.candidateId ?? c.id);
    const fromDb = byId.get(id);
    return {
      ...c,
      interviewNotes: c.interviewNotes || fromDb || '',
    };
  });
}

/**
 * POST /api/admin/vacancies/[id]/assist-ai
 * actions: executiveNote | suggestShortlist | candidateFields | summarizeNotes | vacancyDescription
 */
export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  if (!isOpenAiConfigured()) {
    return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, 503);
  }

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`assist-ai:${payload.userId || ip}`, 30, 15 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const vacancyId = params?.id;
  if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

  const vacancy = await loadVacancyScoped(vacancyId, scope);
  if (!vacancy) return apiError(request, ERR.NOT_FOUND, 404);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');
  const usage = { companyId: vacancy.companyId, userId: payload.userId };

  try {
    if (action === 'executiveNote') {
      const candidates = await enrichCandidatesWithNotes(
        vacancyId,
        Array.isArray(body.candidates) ? body.candidates : [],
        scope
      );
      if (!candidates.length) return apiError(request, ERR.ASSIST_AI_NEED_CANDIDATES, 400);
      const out = await suggestExecutiveNoteAi({ vacancy, candidates, locale, usage });
      return NextResponse.json({ ok: true, action, executiveNote: out.executiveNote, model: out.model });
    }

    if (action === 'suggestShortlist') {
      const candidates = await enrichCandidatesWithNotes(
        vacancyId,
        Array.isArray(body.candidates) ? body.candidates : [],
        scope
      );
      if (!candidates.length) return apiError(request, ERR.ASSIST_AI_NEED_CANDIDATES, 400);
      const out = await suggestShortlistAi({ vacancy, candidates, locale, usage });
      return NextResponse.json({
        ok: true,
        action,
        candidateIds: out.candidateIds,
        rationaleHtml: out.rationaleHtml,
      });
    }

    if (action === 'candidateFields') {
      const candidates = await enrichCandidatesWithNotes(
        vacancyId,
        Array.isArray(body.candidates) ? body.candidates : [],
        scope
      );
      if (!candidates.length) return apiError(request, ERR.ASSIST_AI_NEED_CANDIDATES, 400);
      const out = await suggestCandidateFieldsAi({ vacancy, candidates, locale, usage });
      return NextResponse.json({ ok: true, action, fields: out.fields, model: out.model });
    }

    if (action === 'summarizeNotes') {
      const notesHtml = body.notesHtml ?? body.interviewNotes ?? '';
      const out = await summarizeInterviewNotesAi({
        notesHtml,
        candidateName: body.candidateName || '',
        locale,
        usage,
      });
      return NextResponse.json({ ok: true, action, summaryHtml: out.summaryHtml, model: out.model });
    }

    if (action === 'vacancyDescription') {
      const draftVacancy = {
        ...vacancy,
        title: body.title != null ? String(body.title) : vacancy.title,
        employmentType: body.employmentType != null ? body.employmentType : vacancy.employmentType,
        salaryMin: body.salaryMin != null ? body.salaryMin : vacancy.salaryMin,
        salaryMax: body.salaryMax != null ? body.salaryMax : vacancy.salaryMax,
        description: body.description != null ? body.description : vacancy.description,
      };
      const out = await suggestVacancyDescriptionAi({
        vacancy: draftVacancy,
        locale,
        mode: body.mode || 'auto',
        usage,
      });
      return NextResponse.json({
        ok: true,
        action,
        description: out.description,
        mode: out.mode,
        model: out.model,
      });
    }

    return apiError(request, ERR.INVALID_ACTION, 400);
  } catch (e) {
    const code = e?.code || 'RUBRIC_AI_FAILED';
    if (code === 'ASSIST_AI_PARSE' || code === 'ASSIST_AI_NOTE_SHORT' || code === 'ASSIST_AI_DESC_SHORT') {
      return NextResponse.json(
        { error: code, errorCode: code, raw: e.raw || null },
        { status: 422 }
      );
    }
    if (code === 'ASSIST_AI_NOTES_EMPTY') {
      return apiError(request, code, 400);
    }
    return apiError(request, code, httpStatusForError(code, 502));
  }
}
