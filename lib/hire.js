import { rejectionReasonsSql } from './pipeline.js';
import { query, queryRead, withTransaction } from './db.js';
import { PIPELINE_STAGE, normalizeRejectionReason, normalizeStartDate } from './pipeline.js';
import { canonicalStageJoinSql, canonicalStageExprSql } from './company-pipeline-stages.js';
import { ensureOnboardingCheckins } from './people/onboarding-checkins.js';
import { ensurePreOnboardingChecklist } from './people/pre-onboarding.js';
import { ensureDpDocuments } from './people/employee-dp.js';
import { enrollJobRoleTrailForCandidate } from './lms-job-role-trail.js';
import { EMPLOYMENT_STATUS, VACANCY_STATUS } from './domain-status.js';
import { formatBenefitsForOnboarding } from './company-benefits.js';
import { notifyCompanyManagers } from './manager-notifications.js';
import { NOTIF } from './manager-notification-catalog.js';
import { upsertCandidate, normalizeEmail } from './ae/candidate-upsert.js';
import { issueEmployeePasswordInvite } from './employee-auth.js';
import { ERR } from './api-error-codes.js';
import { fillOrgPositionForHire, lockPositionCompany } from './people/org-positions.js';
import { toDateOnlyIso } from './format-display-date.js';
import { prepareHireEmail, finishHireEmail } from './hire-email.js';
import { saveOnboardingStageChoices, getOnboardingStageChoice } from './people/onboarding-stage-choices.js';
import { normalizeOnboardingStages } from './onboarding-stage-selection.js';

/**
 * Após marcar hired em uma vaga: fecha automaticamente se preenchimentos >= positions_count.
 */
export async function maybeCloseVacancyIfFilled(vacancyId) {
  if (!vacancyId) return { closed: false };
  const vac = await queryRead(
    `SELECT id, positions_count AS "positionsCount", status
     FROM vacancies WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [vacancyId]
  );
  if (vac.rowCount === 0) return { closed: false };
  const need = Math.max(1, Number(vac.rows[0].positionsCount) || 1);
  if (vac.rows[0].status === VACANCY_STATUS.CLOSED) return { closed: false, alreadyClosed: true };

  const filled = await queryRead(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT ass.candidate_id FROM assessments ass
       ${canonicalStageJoinSql('ass')}
       WHERE ass.vacancy_id = $1 AND ${canonicalStageExprSql('ass')} = '${PIPELINE_STAGE.HIRED}'
       UNION
       SELECT vc.candidate_id FROM vacancy_candidates vc
       ${canonicalStageJoinSql('vc')}
       WHERE vc.vacancy_id = $1 AND ${canonicalStageExprSql('vc')} = '${PIPELINE_STAGE.HIRED}'
     ) x`,
    [vacancyId]
  );
  const n = filled.rows[0]?.n ?? 0;
  if (n < need) return { closed: false, filled: n, need };

  await query(`UPDATE vacancies SET status = '${VACANCY_STATUS.CLOSED}' WHERE id = $1 AND deleted = FALSE`, [vacancyId]);
  return { closed: true, filled: n, need };
}

export async function persistCandidateHire(db, { candidateId, vacancyId, startDate, actorId = null, rehiredByUserId = null, corporateEmail, inviteAccess = false, autoInvite = true, onboardingStages }) {
  const sd = normalizeStartDate(startDate) || new Date().toISOString().slice(0, 10);
  const scope = await db.query('SELECT company_id AS "companyId" FROM candidates WHERE id=$1', [candidateId]);
  const companyId = scope.rows[0]?.companyId;
  if (!companyId) { const error = new Error(ERR.CANDIDATE_NOT_FOUND); error.code = ERR.CANDIDATE_NOT_FOUND; throw error; }
  await lockPositionCompany(db, companyId);
  const person = await db.query('SELECT id, email, employment_status AS "employmentStatus" FROM candidates WHERE id=$1 AND company_id=$2 FOR UPDATE', [candidateId, companyId]);
  if (person.rows[0] && person.rows[0].employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    await saveOnboardingStageChoices(db, { companyId, candidateId, stages: onboardingStages, actorId });
  }
  const emailAccess = await prepareHireEmail(db, person.rows[0], { candidateId, companyId, corporateEmail, inviteAccess, autoInvite });
  if (vacancyId) {
    const vacancy = await db.query('SELECT id FROM vacancies WHERE id=$1 AND company_id=$2 AND deleted=FALSE FOR UPDATE', [vacancyId,companyId]);
    if (!vacancy.rowCount) { const error = new Error(ERR.POSITION_REFERENCE); error.code=ERR.POSITION_REFERENCE; throw error; }
    await fillOrgPositionForHire(db, { companyId, candidateId, vacancyId, startDate: sd, actorId });
  }
  await db.query(`UPDATE candidates c SET employment_status='employee', hired_at=COALESCE(hired_at,now()),
    start_date=$2::date,hired_vacancy_id=COALESCE($3::bigint,hired_vacancy_id),
    job_role_id=COALESCE(c.job_role_id,(SELECT v.job_role_id FROM vacancies v WHERE v.id=$3 AND v.company_id=c.company_id AND v.deleted=FALSE))
    WHERE c.id=$1 AND c.company_id=$4`, [candidateId, sd, vacancyId || null, companyId]);
  await db.query(`UPDATE exit_records SET rehired_at=GREATEST(exit_date,$2::date),rehired_by_user_id=$3,updated_at=now()
    WHERE candidate_id=$1 AND company_id=$4 AND rehired_at IS NULL`, [candidateId,sd,rehiredByUserId || actorId,companyId]);
  return {companyId,startDate:sd,emailAccess};
}

export async function markCandidateHired(args) {
  const persisted = await withTransaction(db => persistCandidateHire(db,args));
  await runCandidateHireEffects({ ...args, ...persisted });
  return {startDate:persisted.startDate};
}

/** Post-commit, optional onboarding side effects shared by direct/rehire/pipeline paths. */
export async function runCandidateHireEffects({ companyId, candidateId, startDate, emailAccess, locale }) {
  const sd = startDate;

  if (companyId) {
    try {
      await ensureOnboardingCheckins(query, { companyId, candidateId });
    } catch (err) {
      // Schema may lag behind deploy; hire must still succeed.
      if (err?.code !== '42P01' && err?.code !== '42703') {
        console.error('[hire] onboarding checkins', err?.message || err);
      }
    }
    try {
      await ensurePreOnboardingChecklist(query, { companyId, candidateId });
    } catch (err) {
      if (err?.code !== '42P01' && err?.code !== '42703') {
        console.error('[hire] pre-onboarding', err?.message || err);
      }
    }
    try {
      await ensureDpDocuments(query, { companyId, candidateId });
    } catch (err) {
      if (err?.code !== '42P01' && err?.code !== '42703') {
        console.error('[hire] dp documents', err?.message || err);
      }
    }
    try {
      await enrollJobRoleTrailForCandidate(query, { companyId, candidateId });
    } catch (err) {
      if (err?.code !== '42P01' && err?.code !== '42703') {
        console.error('[hire] lms job-role trail', err?.message || err);
      }
    }
  }
  const access = await finishHireEmail({ candidateId, companyId, emailAccess, locale }, query);
  return { startDate: sd, access };
}

/** Monta timeline unificada do candidato (eventos ordenados). */
export async function buildCandidateTimeline(candidateId) {
  const events = [];

  const cand = await queryRead(
    `SELECT id, full_name AS "fullName", created_at AS "createdAt",
            employment_status AS "employmentStatus", hired_at AS "hiredAt",
            start_date AS "startDate", hired_vacancy_id AS "hiredVacancyId"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (cand.rowCount === 0) return [];
  const c = cand.rows[0];
  events.push({
    type: 'candidate.created',
    at: c.createdAt,
    labelKey: 'recruiting.timelineCandidateCreated',
  });
  if (c.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE && (c.hiredAt || c.startDate)) {
    events.push({
      type: 'candidate.hired',
      at: c.hiredAt || c.startDate,
      startDate: c.startDate,
      vacancyId: c.hiredVacancyId,
      labelKey: 'recruiting.timelineCandidateHired',
    });
  }

  try {
    const vc = await queryRead(
      `SELECT vc.id, vc.vacancy_id AS "vacancyId", v.title AS "vacancyTitle",
              vc.created_at AS "createdAt", vc.pipeline_stage AS "pipelineStage",
              vc.rejection_reason AS "rejectionReason", ${rejectionReasonsSql('vc')} AS "rejectionReasons", vc.start_date AS "startDate",
              vc.hired_at AS "hiredAt"
       FROM vacancy_candidates vc
       JOIN vacancies v ON v.id = vc.vacancy_id
       WHERE vc.candidate_id = $1
       ORDER BY vc.created_at DESC
       LIMIT 40`,
      [candidateId]
    );
    for (const row of vc.rows) {
      events.push({
        type: 'vacancy.registered',
        at: row.createdAt,
        vacancyId: row.vacancyId,
        vacancyTitle: row.vacancyTitle,
        labelKey: 'recruiting.timelineVacancyRegistered',
      });
    }

    const vcIds = vc.rows.map((r) => r.id);
    if (vcIds.length) {
      const vh = await queryRead(
        `SELECT h.vacancy_candidate_id AS "vacancyCandidateId",
                h.from_stage AS "fromStage", h.to_stage AS "toStage",
                h.reason, ${rejectionReasonsSql('h', 'reason')} AS reasons, h.start_date AS "startDate", h.changed_at AS "changedAt",
                vc.vacancy_id AS "vacancyId", v.title AS "vacancyTitle"
         FROM vacancy_candidate_pipeline_history h
         JOIN vacancy_candidates vc ON vc.id = h.vacancy_candidate_id
         JOIN vacancies v ON v.id = vc.vacancy_id
         WHERE h.vacancy_candidate_id = ANY($1::bigint[])
         ORDER BY h.changed_at DESC
         LIMIT 200`,
        [vcIds]
      );
      for (const row of vh.rows) {
        events.push({
          type: 'pipeline.change',
          at: row.changedAt,
          fromStage: row.fromStage,
          toStage: row.toStage,
          reason: row.reason,
          reasons: row.reasons,
          startDate: row.startDate,
          vacancyId: row.vacancyId,
          vacancyTitle: row.vacancyTitle,
          source: 'vacancy_candidate',
          labelKey: 'recruiting.timelinePipelineChange',
        });
      }
    }
  } catch {
    /* tabela pode não existir ainda */
  }

  try {
    const inv = await queryRead(
      `SELECT i.id, i.vacancy_id AS "vacancyId", v.title AS "vacancyTitle",
              i.status, i.sent_at AS "sentAt", i.opened_at AS "openedAt",
              i.completed_at AS "completedAt"
       FROM candidate_invites i
       LEFT JOIN vacancies v ON v.id = i.vacancy_id
       WHERE i.status <> 'cancelled'
         AND (
           i.candidate_id = $1
           OR (
             i.candidate_email IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM candidates c
               WHERE c.id = $1 AND c.email IS NOT NULL
                 AND LOWER(c.email) = LOWER(i.candidate_email)
             )
           )
         )
       ORDER BY i.sent_at DESC
       LIMIT 40`,
      [candidateId]
    );
    for (const row of inv.rows) {
      if (row.sentAt) {
        events.push({
          type: 'invite.sent',
          at: row.sentAt,
          vacancyId: row.vacancyId,
          vacancyTitle: row.vacancyTitle,
          labelKey: 'recruiting.timelineInviteSent',
        });
      }
      if (row.openedAt) {
        events.push({
          type: 'invite.opened',
          at: row.openedAt,
          vacancyId: row.vacancyId,
          vacancyTitle: row.vacancyTitle,
          labelKey: 'recruiting.timelineInviteOpened',
        });
      }
      if (row.completedAt) {
        events.push({
          type: 'invite.completed',
          at: row.completedAt,
          vacancyId: row.vacancyId,
          vacancyTitle: row.vacancyTitle,
          labelKey: 'recruiting.timelineInviteCompleted',
        });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const ass = await queryRead(
      `SELECT ass.id, ass.created_at AS "createdAt", ass.vacancy_id AS "vacancyId",
              v.title AS "vacancyTitle", ass.pipeline_stage AS "pipelineStage",
              ass.top_type AS "topType", ass.rejection_reason AS "rejectionReason", ${rejectionReasonsSql('ass')} AS "rejectionReasons",
              ass.start_date AS "startDate", ass.hired_at AS "hiredAt"
       FROM assessments ass
       LEFT JOIN vacancies v ON v.id = ass.vacancy_id
       WHERE ass.candidate_id = $1
       ORDER BY ass.created_at DESC
       LIMIT 30`,
      [candidateId]
    );
    for (const row of ass.rows) {
      events.push({
        type: 'assessment.completed',
        at: row.createdAt,
        assessmentId: row.id,
        vacancyId: row.vacancyId,
        vacancyTitle: row.vacancyTitle,
        topType: row.topType,
        labelKey: 'recruiting.timelineAssessmentCompleted',
      });
    }

    const aIds = ass.rows.map((r) => r.id);
    if (aIds.length) {
      const ah = await queryRead(
        `SELECT h.assessment_id AS "assessmentId",
                h.from_stage AS "fromStage", h.to_stage AS "toStage",
                h.reason, ${rejectionReasonsSql('h', 'reason')} AS reasons, h.start_date AS "startDate", h.changed_at AS "changedAt",
                ass.vacancy_id AS "vacancyId", v.title AS "vacancyTitle"
         FROM assessment_pipeline_history h
         JOIN assessments ass ON ass.id = h.assessment_id
         LEFT JOIN vacancies v ON v.id = ass.vacancy_id
         WHERE h.assessment_id = ANY($1::bigint[])
         ORDER BY h.changed_at DESC
         LIMIT 200`,
        [aIds]
      );
      for (const row of ah.rows) {
        events.push({
          type: 'pipeline.change',
          at: row.changedAt,
          assessmentId: row.assessmentId,
          fromStage: row.fromStage,
          toStage: row.toStage,
          reason: row.reason,
          reasons: row.reasons,
          startDate: row.startDate,
          vacancyId: row.vacancyId,
          vacancyTitle: row.vacancyTitle,
          source: 'assessment',
          labelKey: 'recruiting.timelinePipelineChange',
        });
      }
    }
  } catch {
    /* ignore */
  }

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const TIMELINE_EVENT_CAP = 120;
  return events.length > TIMELINE_EVENT_CAP
    ? events.slice(events.length - TIMELINE_EVENT_CAP)
    : events;
}

/**
 * Hire kit in-app notification — includes benefits snippet when catalog exists.
 */
export async function notifyHireOnboardingKit(dbOrQuery, {
  companyId,
  candidateId,
  vacancyId = null,
  candidateName = null,
  vacancyTitle = null,
  startDate = null,
  dedupeKey,
  locale = 'pt-BR',
}) {
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false };
  const choice = await getOnboardingStageChoice(dbOrQuery, { companyId: cid, candidateId, stage: 'arrival' });
  if (!choice.enabled) return { ok: true, skipped: true };
  let benefitsSnippet = '—';
  try {
    const text = await formatBenefitsForOnboarding(dbOrQuery, {
      companyId: cid,
      format: 'text',
      locale,
    });
    const compact = String(text || '')
      .replace(/^(Benefícios da Empresa|Company Benefits)\s*/i, '')
      .replace(/\n+/g, ' · ')
      .trim();
    if (compact && !/^Nenhum benefício|^No benefits/i.test(compact)) {
      benefitsSnippet = compact.slice(0, 220);
    }
  } catch {
    /* optional catalog */
  }
  return notifyCompanyManagers(dbOrQuery, {
    companyId: cid,
    type: NOTIF.HIRE_ONBOARDING_KIT,
    entityType: 'candidate',
    entityId: Number(candidateId),
    dedupeKey,
    payload: {
      candidateId: Number(candidateId),
      vacancyId: vacancyId != null ? Number(vacancyId) : null,
      candidateName: candidateName || null,
      vacancyTitle: vacancyTitle || null,
      startDate: startDate || null,
      benefitsSnippet,
    },
  });
}

/**
 * Include an employee without a vacancy funnel (B-RH2-06).
 * Reuses candidate hub + hire side-effects (check-ins, D1, DP, LMS trail).
 */
export async function createEmployeeDirect({
  companyId,
  fullName,
  email,
  startDate = null,
  createdByUserId = null,
  sendAccessInvite = false,
  onboardingStages,
  locale = 'pt-BR',
}) {
  const cid = Number(companyId);
  const safeEmail = normalizeEmail(email);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  if (!safeEmail) {
    return { ok: false, errorCode: ERR.EMAIL_REQUIRED };
  }
  if (normalizeOnboardingStages(onboardingStages) === null) return { ok: false, errorCode: ERR.INVALID_PARAMS };
  if (onboardingStages !== undefined) {
    // Fail before creating the person when the explicit-choice migration is absent.
    await query('SELECT 1 FROM employee_onboarding_stage_choices LIMIT 0');
  }

  const existing = await query(
    `SELECT id, employment_status AS "employmentStatus"
     FROM candidates
     WHERE company_id = $1 AND (LOWER(email) = LOWER($2) OR (employment_status='employee' AND LOWER(personal_email)=LOWER($2)))
     ORDER BY (employment_status='employee') DESC LIMIT 1`,
    [cid, safeEmail]
  );
  if (existing.rowCount > 0 && existing.rows[0].employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE) {
    return { ok: false, errorCode: ERR.EMPLOYEE_ALREADY_EXISTS, candidateId: existing.rows[0].id };
  }

  const up = await upsertCandidate({
    companyId: cid,
    fullName,
    email: safeEmail,
    profile: { source: 'other' },
    createdByUserId,
  });
  if (!up.ok) return up;

  const hired = await markCandidateHired({
    candidateId: up.candidateId,
    vacancyId: null,
    startDate,
    actorId: createdByUserId,
    onboardingStages,
  });

  let invite = null;
  if (sendAccessInvite) {
    invite = await issueEmployeePasswordInvite(query, {
      companyId: cid,
      candidateId: up.candidateId,
      locale,
      purpose: 'invite',
      requireMail: true,
    });
  }

  return {
    ok: true,
    candidateId: up.candidateId,
    startDate: hired.startDate,
    inviteSent: Boolean(invite?.ok && invite?.sent),
    inviteErrorCode: invite && !invite.ok ? invite.errorCode : null,
  };
}

/**
 * Reactivate an alumni (people come back). Keeps the exit record as history
 * (closed with rehired_at) and reuses the hire side-effects.
 */
export async function rehireEmployee({
  companyId,
  candidateId,
  rehireDate = null,
  corporateEmail,
  rehiredByUserId = null,
  sendAccessInvite = false,
  locale = 'pt-BR',
}) {
  const cid = Number(companyId);
  const pid = Number(candidateId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(pid) || pid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const cand = await query(
    `SELECT c.id, c.employment_status AS "employmentStatus",
            (SELECT e.exit_date FROM exit_records e
              WHERE e.candidate_id = c.id AND e.rehired_at IS NULL
              ORDER BY e.exit_date DESC, e.id DESC LIMIT 1) AS "openExitDate"
       FROM candidates c
      WHERE c.id = $1 AND c.company_id = $2
      LIMIT 1`,
    [pid, cid]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  const row = cand.rows[0];
  if (row.employmentStatus !== EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.NOT_ALUMNI };
  }

  const today = new Date().toISOString().slice(0, 10);
  const returnDate = normalizeStartDate(rehireDate) || today;
  const exitDate = row.openExitDate ? toDateOnlyIso(row.openExitDate) : null;
  if (exitDate && returnDate < exitDate) {
    return { ok: false, errorCode: ERR.REHIRE_BEFORE_EXIT };
  }

  const hired = await markCandidateHired({
    candidateId: pid,
    vacancyId: null,
    startDate: returnDate,
    rehiredByUserId,
    corporateEmail,
    inviteAccess: true,
    autoInvite: false,
  });

  let invite = null;
  if (sendAccessInvite) {
    invite = await issueEmployeePasswordInvite(query, {
      companyId: cid,
      candidateId: pid,
      locale,
      purpose: 'invite',
      requireMail: true,
    });
  }

  return {
    ok: true,
    candidateId: pid,
    rehireDate: hired.startDate,
    inviteSent: Boolean(invite?.ok && invite?.sent),
    inviteErrorCode: invite && !invite.ok ? invite.errorCode : null,
  };
}

export { normalizeRejectionReason, normalizeStartDate };
