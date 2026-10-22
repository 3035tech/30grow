import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../lib/auth';
import { query, queryRead, withTransaction } from '../../../../../lib/db';
import { audit } from '../../../../../lib/audit';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error';
import {
  PIPELINE_STAGE,
  normalizeRejectionReasons,
  normalizeStartDate,
} from '../../../../../lib/pipeline';
import { resolveRecruitingPipelineStage } from '../../../../../lib/pipeline-templates';
import { persistCandidateHire, runCandidateHireEffects, maybeCloseVacancyIfFilled, notifyHireOnboardingKit } from '../../../../../lib/hire';
import { canAccessCandidateRecord, isAdminRole } from '../../../../../lib/permissions';
import { pipelineStageToFunnelEvent, scheduleJobFunnelEvent } from '../../../../../lib/job-funnel';

export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!canAccessCandidateRecord(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isAdminRole(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const id = params?.id;
    if (!id) return apiError(request, ERR.INVALID_ID, 400);

    const body = await request.json().catch(() => ({}));
    const stage = body.pipelineStage != null ? String(body.pipelineStage).trim() : null;
    if (!stage) {
      return apiError(request, ERR.INVALID_PIPELINE_STAGE, 400);
    }

    const selectedReasons = normalizeRejectionReasons(body.rejectionReasons ?? body.rejectionReason ?? body.reason);
    const rejectionReason = selectedReasons?.[0] ?? null;
    const startDate = normalizeStartDate(body.startDate);

    const own = await queryRead(
      `SELECT ass.id, ass.pipeline_stage AS "currentStage",
              ass.candidate_id AS "candidateId", ass.vacancy_id AS "vacancyId",
              ass.company_id AS "companyId",
              ass.attr_source AS "attrSource",
              ass.attr_medium AS "attrMedium",
              ass.attr_campaign AS "attrCampaign",
              ass.attr_ref AS "attrRef",
              ass.attr_session_id AS "attrSessionId",
              c.full_name AS "candidateName",
              v.title AS "vacancyTitle"
       FROM assessments ass
       LEFT JOIN candidates c ON c.id = ass.candidate_id
       LEFT JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE
       WHERE ass.id = $1 ${!isAdmin ? 'AND ass.company_id = $2' : ''}
       LIMIT 1`,
      !isAdmin ? [id, companyId] : [id]
    );
    if (own.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);
    const currentStage = own.rows[0]?.currentStage || null;
    const candidateId = own.rows[0]?.candidateId;
    const vacancyId = own.rows[0]?.vacancyId;
    const assCompanyId = own.rows[0]?.companyId;
    const resolvedStage = await resolveRecruitingPipelineStage({ companyId: assCompanyId, vacancyId, stageKey: stage });
    if (!resolvedStage) return apiError(request, ERR.INVALID_PIPELINE_STAGE, 400);
    const canonicalStage = resolvedStage.canonicalKey;

    if (canonicalStage === PIPELINE_STAGE.REJECTED && !rejectionReason) {
      return apiError(request, ERR.REJECTION_REASON_REQUIRED, 400);
    }
    if (canonicalStage === PIPELINE_STAGE.HIRED && !startDate) {
      return apiError(request, ERR.START_DATE_REQUIRED, 400);
    }

    const rejectionReasons = canonicalStage === PIPELINE_STAGE.REJECTED ? selectedReasons : [];
    const funnelEvent = pipelineStageToFunnelEvent(canonicalStage);


    const up = await withTransaction(async db => {
    const result = await db.query(
      `UPDATE assessments SET
         pipeline_stage = $2,
         rejection_reasons = $7::text[],
         rejection_reason = CASE WHEN $6 = '${PIPELINE_STAGE.REJECTED}' THEN $3 ELSE NULL END,
         start_date = CASE WHEN $6 = '${PIPELINE_STAGE.HIRED}' THEN $4::date ELSE start_date END,
         hired_at = CASE
           WHEN $6 = '${PIPELINE_STAGE.HIRED}' THEN COALESCE(hired_at, NOW())
           ELSE hired_at
         END
       WHERE id = $1 AND company_id = $5
       RETURNING id, pipeline_stage AS "pipelineStage",
                 rejection_reason AS "rejectionReason", rejection_reasons AS "rejectionReasons",
                 start_date AS "startDate",
                 hired_at AS "hiredAt"`,
      [id, stage, rejectionReason, startDate, assCompanyId, canonicalStage, rejectionReasons]
    );

    await db.query(
      `INSERT INTO assessment_pipeline_history
         (assessment_id, from_stage, to_stage, reason, start_date, changed_by_user_id, rejection_reasons)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
      [
        id,
        currentStage,
        stage,
        canonicalStage === PIPELINE_STAGE.REJECTED ? rejectionReason : null,
        canonicalStage === PIPELINE_STAGE.HIRED ? startDate : null,
        payload.userId || null,
        rejectionReasons,
      ]
    );

    if (canonicalStage === PIPELINE_STAGE.HIRED && candidateId) await persistCandidateHire(db,{candidateId,vacancyId,startDate,actorId:payload.userId});
    if (vacancyId && candidateId) {
      await db.query(
        `UPDATE vacancy_candidates SET rejection_reasons = $3::text[],
           rejection_reason = $4, updated_at = NOW()
         WHERE vacancy_id = $1 AND candidate_id = $2 AND company_id = $5`,
        [vacancyId, candidateId, rejectionReasons, rejectionReasons[0] ?? null, assCompanyId]
      );
    }
    return result;
    });

    if (funnelEvent && vacancyId && assCompanyId && stage !== currentStage) {
      scheduleJobFunnelEvent({
        companyId: assCompanyId,
        vacancyId,
        eventType: funnelEvent,
        candidateId,
        sessionId: own.rows[0]?.attrSessionId || null,
        source: own.rows[0]?.attrSource || null,
        medium: own.rows[0]?.attrMedium || null,
        campaign: own.rows[0]?.attrCampaign || null,
        referralCode: own.rows[0]?.attrRef || null,
      });
    }

    if (canonicalStage === PIPELINE_STAGE.HIRED && candidateId) {
      await runCandidateHireEffects({ companyId:assCompanyId,candidateId,startDate });
      if (vacancyId) {
        await query(
          `UPDATE vacancy_candidates SET
             pipeline_stage = $4,
             start_date = COALESCE($3::date, start_date),
             hired_at = COALESCE(hired_at, NOW()),
             rejection_reason = NULL,
             updated_at = NOW()
           WHERE vacancy_id = $1 AND candidate_id = $2`,
          [vacancyId, candidateId, startDate, stage]
        ).catch(() => {});
        await maybeCloseVacancyIfFilled(vacancyId);
      }
      if (assCompanyId) {
        await notifyHireOnboardingKit(query, {
          companyId: assCompanyId,
          candidateId: Number(candidateId),
          vacancyId: vacancyId != null ? Number(vacancyId) : null,
          candidateName: own.rows[0]?.candidateName || null,
          vacancyTitle: own.rows[0]?.vacancyTitle || null,
          startDate: startDate || null,
          dedupeKey: `hire_kit:assessment:${id}:candidate:${candidateId}`,
        });
      }
    }

    if (canonicalStage === PIPELINE_STAGE.REJECTED && vacancyId && candidateId) {
      await query(
        `UPDATE vacancy_candidates SET
           pipeline_stage = $4,
           rejection_reason = $3,
           updated_at = NOW()
         WHERE vacancy_id = $1 AND candidate_id = $2`,
        [vacancyId, candidateId, rejectionReason, stage]
      ).catch(() => {});
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'assessment.pipeline_update',
      targetType: 'assessment',
      targetId: String(id),
      metadata: {
        pipelineStage: stage,
        rejectionReasons,
        rejectionReason: canonicalStage === PIPELINE_STAGE.REJECTED ? rejectionReason : undefined,
        startDate: canonicalStage === PIPELINE_STAGE.HIRED ? startDate : undefined,
      },
    });

    return NextResponse.json(up.rows[0]);
  } catch (e) {
    if (Object.values(ERR).includes(e?.code)) return apiErrorFromResult(request,{errorCode:e.code});
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!canAccessCandidateRecord(payload)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isAdminRole(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const id = params?.id;
    if (!id) return apiError(request, ERR.INVALID_ID, 400);

    const row = await queryRead(
      `SELECT ass.id, ass.invite_id AS "inviteId"
       FROM assessments ass
       WHERE ass.id = $1 ${!isAdmin ? 'AND ass.company_id = $2' : ''}
       LIMIT 1`,
      !isAdmin ? [id, companyId] : [id]
    );
    if (row.rowCount === 0) return apiError(request, ERR.NOT_FOUND, 404);

    const inviteId = row.rows[0]?.inviteId;

    await query(
      `DELETE FROM assessments WHERE id = $1 ${!isAdmin ? 'AND company_id = $2' : ''}`,
      !isAdmin ? [id, companyId] : [id]
    );

    if (inviteId != null) {
      await query(
        `UPDATE candidate_invites SET status = 'opened', completed_at = NULL WHERE id = $1`,
        [inviteId]
      );
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'assessment.delete_retake',
      targetType: 'assessment',
      targetId: String(id),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
