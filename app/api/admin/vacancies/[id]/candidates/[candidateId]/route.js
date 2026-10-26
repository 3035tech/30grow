import { normalizeOnboardingStages } from '../../../../../../../lib/onboarding-stage-selection.js';
import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../lib/auth';
import { query, withTransaction } from '../../../../../../../lib/db';
import { sanitizeInterviewNotesHtml } from '../../../../../../../lib/sanitize-html';
import { apiError, apiErrorFromResult, localeFromRequest, ERR } from '../../../../../../../lib/api-error';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../../../../lib/permissions';
import {
  PIPELINE_STAGE,
  normalizeRejectionReasons,
  normalizeStartDate,
  rejectionReasonsSql,
} from '../../../../../../../lib/recruiting/pipeline';
import { resolveRecruitingPipelineStage } from '../../../../../../../lib/recruiting/pipeline-templates';
import { pipelineStageToFunnelEvent, scheduleJobFunnelEvent } from '../../../../../../../lib/recruiting/job-funnel';
import { auditFromRequest } from '../../../../../../../lib/audit';


async function loadLink(request, vacancyId, candidateId, payload) {
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  if (!isAdmin && !companyId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };

  const r = await query(
    `SELECT vc.id, vc.vacancy_id AS "vacancyId", vc.candidate_id AS "candidateId",
            vc.company_id AS "companyId", vc.interview_notes AS "interviewNotes",
            vc.pipeline_stage AS "pipelineStage",
            c.full_name AS "fullName", c.email,
            v.status AS "vacancyStatus", v.title AS "vacancyTitle",
            co.name AS "companyName"
     FROM vacancy_candidates vc
     JOIN candidates c ON c.id = vc.candidate_id
     JOIN vacancies v ON v.id = vc.vacancy_id
     JOIN companies co ON co.id = v.company_id
     WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2
       AND v.deleted = FALSE AND co.deleted = FALSE
     LIMIT 1`,
    [vacancyId, candidateId]
  );
  if (r.rowCount === 0) return { error: apiError(request, ERR.NOT_FOUND, 404) };
  if (!isAdmin && String(r.rows[0].companyId) !== String(companyId)) {
    return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  }
  return { link: r.rows[0] };
}

/** Details for this candidature only, including legacy assessments without a link row. */
export async function GET(request, props) {
  try {
    const params = await props.params;
    const cookieStore = await cookies();
    const payload = await verifySessionWithCapabilities(cookieStore.get(COOKIE_NAME)?.value);
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const isAdmin = isSuperAdminPayload(payload);
    if (!isAdmin && !payload?.companyId) return apiError(request, ERR.UNAUTHORIZED, 401);
    const vacancyId = Number(params?.id);
    const candidateId = Number(params?.candidateId);
    if (!Number.isSafeInteger(vacancyId) || vacancyId <= 0 || !Number.isSafeInteger(candidateId) || candidateId <= 0) {
      return apiError(request, ERR.INVALID_PARAMS, 400);
    }
    const detail = await query(
      `SELECT c.id AS "candidateId", v.company_id AS "companyId", v.title AS "vacancyTitle",
              c.full_name AS name, c.email, c.phone, c.city, c.state, c.employment_status AS "employmentStatus",
              c.professional_summary AS "professionalSummary", vc.interview_notes AS "interviewNotes"
       FROM vacancies v
       JOIN candidates c ON c.id = $2 AND c.company_id = v.company_id
       JOIN companies co ON co.id = v.company_id AND co.deleted = FALSE
       LEFT JOIN vacancy_candidates vc ON vc.vacancy_id = v.id AND vc.candidate_id = c.id AND vc.company_id = v.company_id
       WHERE v.id = $1 AND v.deleted = FALSE ${!isAdmin ? 'AND v.company_id = $3' : ''}
         AND (vc.id IS NOT NULL OR EXISTS (
           SELECT 1 FROM assessments a WHERE a.vacancy_id = v.id AND a.candidate_id = c.id AND a.company_id = v.company_id
         ))
       LIMIT 1`,
      !isAdmin ? [vacancyId, candidateId, payload.companyId] : [vacancyId, candidateId]
    );
    if (!detail.rowCount) return apiError(request, ERR.NOT_FOUND, 404);
    const history = await query(
      `SELECT * FROM (
         SELECT 'assessment:' || h.id AS "eventKey", h.from_stage AS "fromStage", h.to_stage AS "toStage",
                h.changed_at AS "changedAt", h.reason, ${rejectionReasonsSql('h', 'reason')} AS reasons
         FROM assessment_pipeline_history h JOIN assessments a ON a.id = h.assessment_id
         WHERE a.vacancy_id = $1 AND a.candidate_id = $2 AND a.company_id = $3
         UNION ALL
         SELECT 'candidate:' || h.id AS "eventKey", h.from_stage AS "fromStage", h.to_stage AS "toStage",
                h.changed_at AS "changedAt", h.reason, ${rejectionReasonsSql('h', 'reason')} AS reasons
         FROM vacancy_candidate_pipeline_history h JOIN vacancy_candidates vc ON vc.id = h.vacancy_candidate_id
         WHERE vc.vacancy_id = $1 AND vc.candidate_id = $2 AND vc.company_id = $3
       ) events ORDER BY "changedAt" DESC, "eventKey" DESC LIMIT 31`,
      [vacancyId, candidateId, detail.rows[0].companyId]
    );
    return NextResponse.json({ ...detail.rows[0], history: history.rows.slice(0, 30), historyTruncated: history.rows.length > 30 });
  } catch (error) {
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** Atualiza anotações da entrevista (HTML) e/ou estágio do funil. */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    const candidateId = params?.candidateId;
    if (!vacancyId || !candidateId) return apiError(request, ERR.INVALID_PARAMS, 400);

    const loaded = await loadLink(request, vacancyId, candidateId, payload);
    if (loaded.error) return loaded.error;

    const body = await request.json().catch(() => ({}));
    const onboardingStages = normalizeOnboardingStages(body.onboardingStages);
    if (onboardingStages === null) return apiError(request, ERR.INVALID_PARAMS, 400);
    if (body.interviewNotes === undefined && body.notes === undefined && body.pipelineStage === undefined) {
      return apiError(request, ERR.NOTHING_TO_UPDATE, 400);
    }

    let notes = loaded.link.interviewNotes;
    if (body.interviewNotes !== undefined || body.notes !== undefined) {
      notes = sanitizeInterviewNotesHtml(body.interviewNotes ?? body.notes);
    }

    let stage = undefined;
    let stageCanonical = null;
    let rejectionReason = null;
    let rejectionReasons = [];
    let startDate = null;
    if (body.pipelineStage !== undefined) {
      const s = body.pipelineStage == null ? null : String(body.pipelineStage).trim();
      if (s != null) {
        const resolved = await resolveRecruitingPipelineStage({ companyId: loaded.link.companyId, vacancyId, stageKey: s });
        if (!resolved) {
          return apiError(request, ERR.INVALID_PIPELINE_STAGE, 400);
        }
        stageCanonical = resolved.canonicalKey;
      }
      stage = s;
      const selectedReasons = normalizeRejectionReasons(body.rejectionReasons ?? body.rejectionReason ?? body.reason);
      rejectionReason = selectedReasons?.[0] ?? null;
      rejectionReasons = stageCanonical === PIPELINE_STAGE.REJECTED ? selectedReasons : [];
      startDate = normalizeStartDate(body.startDate);
      if (stageCanonical === PIPELINE_STAGE.REJECTED && !rejectionReason) {
        return apiError(request, ERR.REJECTION_REASON_REQUIRED, 400);
      }
      if (stageCanonical === PIPELINE_STAGE.HIRED && body.startDate && !startDate) return apiError(request, ERR.INVALID_DATA, 400);
    }

    const currentStage = loaded.link.pipelineStage || null;
    const isRejectedCanonical = stageCanonical === PIPELINE_STAGE.REJECTED;
    const isHiredCanonical = stageCanonical === PIPELINE_STAGE.HIRED;

    const upd = await withTransaction(async db => {
    const updated = await db.query(
      `UPDATE vacancy_candidates
       SET interview_notes = CASE WHEN $3::boolean THEN $4 ELSE interview_notes END,
           pipeline_stage = CASE WHEN $5::boolean THEN $6 ELSE pipeline_stage END,
           rejection_reasons = CASE WHEN $5::boolean THEN $11::text[] ELSE rejection_reasons END,
           rejection_reason = CASE
             WHEN $5::boolean AND $9::boolean THEN $7
             WHEN $5::boolean AND NOT $9::boolean THEN NULL
             ELSE rejection_reason
           END,
           start_date = CASE
             WHEN $5::boolean AND $10::boolean THEN $8::date
             ELSE start_date
           END,
           hired_at = CASE
             WHEN $5::boolean AND $10::boolean THEN COALESCE(hired_at, NOW())
             ELSE hired_at
           END,
           updated_at = NOW()
       WHERE vacancy_id = $1 AND candidate_id = $2
       RETURNING id, vacancy_id AS "vacancyId", candidate_id AS "candidateId",
                 interview_notes AS "interviewNotes", pipeline_stage AS "pipelineStage",
                 rejection_reason AS "rejectionReason", rejection_reasons AS "rejectionReasons", start_date AS "startDate",
                 hired_at AS "hiredAt", updated_at AS "updatedAt"`,
      [
        vacancyId,
        candidateId,
        body.interviewNotes !== undefined || body.notes !== undefined,
        body.interviewNotes !== undefined || body.notes !== undefined ? notes : null,
        body.pipelineStage !== undefined,
        stage ?? null,
        rejectionReason,
        startDate,
        isRejectedCanonical,
        isHiredCanonical,
        rejectionReasons,
      ]
    );

    if (body.pipelineStage !== undefined && stage != null) {
      await db.query(
        `INSERT INTO vacancy_candidate_pipeline_history
           (vacancy_candidate_id, from_stage, to_stage, reason, start_date, changed_by_user_id, rejection_reasons)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
        [loaded.link.id, currentStage, stage, isRejectedCanonical ? rejectionReason : null,
         isHiredCanonical ? startDate : null, payload.userId || null, rejectionReasons]
      );
    }
    return updated;
    });

    if (body.pipelineStage !== undefined && stage != null) {
      const funnelEvent = pipelineStageToFunnelEvent(stageCanonical);
      if (funnelEvent && stage !== currentStage) {
        scheduleJobFunnelEvent({
          companyId: loaded.link.companyId,
          vacancyId: Number(vacancyId),
          eventType: funnelEvent,
          candidateId: Number(candidateId),
        });
      }
    }

    await auditFromRequest(request, {
      actorUserId: payload.userId || null,
      companyId: loaded.link.companyId,
      action: isHiredCanonical
        ? 'recruiting.candidate.hired'
        : 'recruiting.candidate.updated',
      targetType: 'vacancy_candidate',
      targetId: loaded.link.id,
      metadata: {
        employmentActivated: false,
        onboardingStages,
        vacancyId: Number(vacancyId),
        candidateId: Number(candidateId),
        pipelineStage: stage ?? currentStage,
        rejectionReasons: body.pipelineStage !== undefined ? rejectionReasons : undefined,
        notesUpdated: body.interviewNotes !== undefined || body.notes !== undefined,
      },
    });

    return NextResponse.json({
      ...upd.rows[0],
      fullName: loaded.link.fullName,
      email: loaded.link.email,
      access: null,
    });
  } catch (error) {
    if ((error)?.code === '23505' && String((error)?.constraint || '').includes('email')) return apiError(request, ERR.EMAIL_TAKEN, 409);
    if (Object.values(ERR).includes(error?.code)) return apiErrorFromResult(request,{errorCode:error.code});
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
