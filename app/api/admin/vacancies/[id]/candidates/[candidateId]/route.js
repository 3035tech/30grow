import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../../lib/auth';
import { query, withTransaction } from '../../../../../../../lib/db';
import { sanitizeInterviewNotesHtml } from '../../../../../../../lib/sanitize-html';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error';
import { CAP, isAdminRole, requireCapability } from '../../../../../../../lib/permissions';
import {
  PIPELINE_STAGE,
  normalizeRejectionReason,
  normalizeStartDate,
} from '../../../../../../../lib/pipeline';
import { resolveRecruitingPipelineStage } from '../../../../../../../lib/pipeline-templates';
import { persistCandidateHire, runCandidateHireEffects, maybeCloseVacancyIfFilled, notifyHireOnboardingKit } from '../../../../../../../lib/hire';
import { pipelineStageToFunnelEvent, scheduleJobFunnelEvent } from '../../../../../../../lib/job-funnel';
import { auditFromRequest } from '../../../../../../../lib/audit';


async function loadLink(request, vacancyId, candidateId, payload) {
  const isAdmin = isAdminRole(payload);
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
      rejectionReason = normalizeRejectionReason(body.rejectionReason ?? body.reason);
      startDate = normalizeStartDate(body.startDate);
      if (stageCanonical === PIPELINE_STAGE.REJECTED && !rejectionReason) {
        return apiError(request, ERR.REJECTION_REASON_REQUIRED, 400);
      }
      if (stageCanonical === PIPELINE_STAGE.HIRED && !startDate) {
        return apiError(request, ERR.START_DATE_REQUIRED, 400);
      }
    }

    const currentStage = loaded.link.pipelineStage || null;
    const isRejectedCanonical = stageCanonical === PIPELINE_STAGE.REJECTED;
    const isHiredCanonical = stageCanonical === PIPELINE_STAGE.HIRED;

    const upd = await withTransaction(async db => {
    const updated = await db.query(
      `UPDATE vacancy_candidates
       SET interview_notes = CASE WHEN $3::boolean THEN $4 ELSE interview_notes END,
           pipeline_stage = CASE WHEN $5::boolean THEN $6 ELSE pipeline_stage END,
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
                 rejection_reason AS "rejectionReason", start_date AS "startDate",
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
      ]
    );

    if (isHiredCanonical) await persistCandidateHire(db,{candidateId,vacancyId,startDate,actorId:payload.userId});
    return updated;
    });

    if (body.pipelineStage !== undefined && stage != null) {
      await query(
        `INSERT INTO vacancy_candidate_pipeline_history
           (vacancy_candidate_id, from_stage, to_stage, reason, start_date, changed_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          loaded.link.id,
          currentStage,
          stage,
          isRejectedCanonical ? rejectionReason : null,
          isHiredCanonical ? startDate : null,
          payload.userId || null,
        ]
      ).catch(() => {});

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

    if (isHiredCanonical) {
      await runCandidateHireEffects({ companyId:loaded.link.companyId,candidateId,startDate });
      await maybeCloseVacancyIfFilled(vacancyId);
      await notifyHireOnboardingKit(query, {
        companyId: loaded.link.companyId,
        candidateId: Number(candidateId),
        vacancyId: Number(vacancyId),
        candidateName: loaded.link.fullName || null,
        vacancyTitle: loaded.link.vacancyTitle || null,
        startDate: startDate || null,
        dedupeKey: `hire_kit:vacancy:${vacancyId}:candidate:${candidateId}`,
      });
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
        vacancyId: Number(vacancyId),
        candidateId: Number(candidateId),
        pipelineStage: stage ?? currentStage,
        notesUpdated: body.interviewNotes !== undefined || body.notes !== undefined,
      },
    });

    return NextResponse.json({
      ...upd.rows[0],
      fullName: loaded.link.fullName,
      email: loaded.link.email,
    });
  } catch (error) {
    if (Object.values(ERR).includes(error?.code)) return apiErrorFromResult(request,{errorCode:error.code});
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
