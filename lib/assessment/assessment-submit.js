import { query } from '../db.js';
import { computeAssessmentFromAnswers } from './assessment-score.js';
import { upsertCandidate, normalizeEmail } from '../ae/candidate-upsert.js';
import { normalizeCandidateProfile } from '../recruiting/candidate-profile.js';
import { notifyCompanyManagers, NOTIF } from '../manager-notifications.js';
import { ERR } from '../api-error-codes.js';
import {
  attributionToAssessmentCols,
  decodeAttributionCookie,
  mapAttributionToCandidateSource,
} from '../recruiting/job-attribution.js';
import { scheduleJobFunnelEvent } from '../recruiting/job-funnel.js';
import { EMPLOYMENT_STATUS, VACANCY_STATUS } from '../domain-status.js';

const MAX_FILL_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize optional anti-IA telemetry from the public assessment client.
 * @returns {{ fillDurationMs: number|null, copyEventCount: number }}
 */
export function normalizeAssessmentTelemetry(body = {}) {
  let fillDurationMs = null;
  if (body.fillDurationMs != null && body.fillDurationMs !== '') {
    const n = Number(body.fillDurationMs);
    if (Number.isFinite(n) && n >= 0 && n <= MAX_FILL_MS) fillDurationMs = Math.round(n);
  }
  let copyEventCount = 0;
  if (body.copyEventCount != null && body.copyEventCount !== '') {
    const n = Number(body.copyEventCount);
    if (Number.isFinite(n) && n >= 0) copyEventCount = Math.min(9999, Math.round(n));
  }
  return { fillDurationMs, copyEventCount };
}

/**
 * Persist a public T1–T9 assessment submit (company or vacancy token).
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} [opts.email]
 * @param {string} opts.areaKey
 * @param {boolean} opts.consent
 * @param {unknown} opts.answers
 * @param {string} [opts.companyToken]
 * @param {string} [opts.vacancyToken]
 * @param {string} [opts.inviteToken]
 * @param {object} [opts.profileBody] — raw body for normalizeCandidateProfile
 * @param {string} [opts.attributionCookieValue]
 * @param {number|null} [opts.fillDurationMs]
 * @param {number} [opts.copyEventCount]
 * @returns {Promise<
 *   | { ok: true, candidateId: number, assessmentId: number, createdAt: unknown, vacancyId?: number }
 *   | { ok: false, errorCode: string, status: number, values?: object }
 * >}
 */
export async function submitAssessmentResult({
  name,
  email,
  areaKey,
  consent,
  answers,
  companyToken,
  vacancyToken,
  inviteToken: rawInviteToken,
  profileBody,
  attributionCookieValue,
  fillDurationMs = null,
  copyEventCount = 0,
}) {
  const inviteToken = String(rawInviteToken || '').trim();
  const safeEmail = normalizeEmail(email);

  if ((!companyToken && !vacancyToken) || !name || !areaKey || consent !== true) {
    return { ok: false, errorCode: ERR.INCOMPLETE_DATA, status: 400 };
  }

  const scored = computeAssessmentFromAnswers(answers);
  if (!scored.ok) {
    return { ok: false, errorCode: scored.errorCode, status: 400, values: scored.values };
  }
  const { topType, scores } = scored;

  let companyId = null;
  let resolvedVacancyId = null;
  let resolvedInviteId = null;
  let resolvedCandidateId = null;

  if (vacancyToken) {
    const token = String(vacancyToken || '').trim();
    const link = await query(
      `SELECT v.id AS "vacancyId", v.company_id AS "companyId", v.status,
              COALESCE(l.require_candidate_email, FALSE) AS "requireCandidateEmail"
       FROM vacancy_links l
       JOIN vacancies v ON v.id = l.vacancy_id
       JOIN companies c ON c.id = v.company_id
       WHERE l.token = $1 AND l.active = TRUE AND l.expires_at > NOW()
         AND v.deleted = FALSE AND c.deleted = FALSE
       LIMIT 1`,
      [token]
    );
    if (link.rowCount === 0) {
      return { ok: false, errorCode: ERR.EXPIRED_LINK, status: 403 };
    }
    if (String(link.rows[0].status || '') === VACANCY_STATUS.CLOSED) {
      return { ok: false, errorCode: ERR.CLOSED_VACANCY, status: 403 };
    }
    companyId = link.rows[0].companyId;
    resolvedVacancyId = link.rows[0].vacancyId;
    if (!safeEmail) {
      return { ok: false, errorCode: ERR.REQUIRED_VACANCY_EMAIL, status: 400 };
    }

    if (inviteToken) {
      const inv = await query(
        `SELECT ci.id, ci.candidate_id AS "candidateId", ci.vacancy_id AS "vacancyId", LOWER(TRIM(ci.candidate_email)) AS "inviteEmail", LOWER(TRIM(person.email)) AS "currentEmail"
         FROM candidate_invites ci
         LEFT JOIN candidates person ON person.id=ci.candidate_id AND person.company_id=ci.company_id
         WHERE ci.token = $1 AND ci.status IN ('sent', 'opened')
         LIMIT 1`,
        [inviteToken]
      );
      if (inv.rowCount === 0) {
        return { ok: false, errorCode: ERR.INVITE_INVALID, status: 400 };
      }
      const invRow = inv.rows[0];
      if (Number(invRow.vacancyId) !== Number(resolvedVacancyId)) {
        return { ok: false, errorCode: ERR.INVITE_INVALID, status: 400 };
      }
      if (invRow.inviteEmail !== safeEmail && invRow.currentEmail !== safeEmail) {
        return { ok: false, errorCode: ERR.INVITE_EMAIL_MISMATCH, status: 400 };
      }
      resolvedInviteId = invRow.id;
      resolvedCandidateId = invRow.candidateId ?? null;
    }
  } else {
    const token = String(companyToken || '').trim();
    const link = await query(
      `SELECT l.company_id AS "companyId",
              COALESCE(l.require_candidate_email, FALSE) AS "requireCandidateEmail"
       FROM company_links l
       JOIN companies c ON c.id = l.company_id
       WHERE l.token = $1 AND l.active = TRUE AND l.expires_at > NOW()
         AND c.deleted = FALSE
       LIMIT 1`,
      [token]
    );
    if (link.rowCount === 0) {
      return { ok: false, errorCode: ERR.EXPIRED_LINK, status: 403 };
    }
    companyId = link.rows[0].companyId;
    if (!safeEmail) {
      return { ok: false, errorCode: ERR.REQUIRED_CONTACT_EMAIL, status: 400 };
    }
  }

  const safeName = String(name).trim();

  const areaRes = await query(`SELECT id FROM areas WHERE key = $1 LIMIT 1`, [areaKey]);
  if (areaRes.rowCount === 0) {
    return { ok: false, errorCode: ERR.INVALID_AREA, status: 400 };
  }
  const areaId = areaRes.rows[0].id;

  const profile = normalizeCandidateProfile(profileBody || {});
  const attr = decodeAttributionCookie(attributionCookieValue);
  const mappedSource = mapAttributionToCandidateSource(attr);
  if (mappedSource && !profile.source) {
    profile.source = mappedSource;
  }
  const up = await upsertCandidate({
    companyId,
    fullName: safeName,
    candidateId: resolvedCandidateId,
    email: safeEmail,
    profile,
  });
  if (!up.ok) {
    return { ok: false, errorCode: up.errorCode || 'INCOMPLETE_DATA', status: 400 };
  }
  const candidateId = up.candidateId;

  // Company link (/t/…) is for the internal team — mark as employee (not recruiting).
  if (!resolvedVacancyId) {
    await query(
      `UPDATE candidates
       SET employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       WHERE id = $1
         AND employment_status = '${EMPLOYMENT_STATUS.CANDIDATE}'`,
      [candidateId]
    );
  }

  if (resolvedVacancyId) {
    const existingAssessment = await query(
      `SELECT 1
       FROM assessments
       WHERE candidate_id = $1 AND vacancy_id = $2
       LIMIT 1`,
      [candidateId, resolvedVacancyId]
    );
    if (existingAssessment.rowCount > 0) {
      return { ok: false, errorCode: ERR.DUPLICATE_VACANCY_SUBMISSION, status: 409 };
    }
  } else if (safeEmail) {
    // Company link (/t): block a second Eneagram for the same person (same e-mail), like Motivators.
    const existingCompany = await query(
      `SELECT 1
       FROM assessments ass
       JOIN candidates c ON c.id = ass.candidate_id
       WHERE c.company_id = $1
         AND LOWER(TRIM(c.email)) = LOWER(TRIM($2::text))
         AND ass.vacancy_id IS NULL
       LIMIT 1`,
      [companyId, safeEmail]
    );
    if (existingCompany.rowCount > 0) {
      return { ok: false, errorCode: ERR.ALREADY_SUBMITTED, status: 409 };
    }
  }

  const attrCols = attributionToAssessmentCols(attr);

  const assessment = resolvedVacancyId
    ? await query(
        `INSERT INTO assessments (
           candidate_id, company_id, area_id, top_type, scores, vacancy_id, invite_id,
           pipeline_stage, fill_duration_ms, copy_event_count,
           attr_source, attr_medium, attr_campaign, attr_content, attr_term,
           attr_ref, attr_landing, attr_session_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'test_completed', $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17
         )
         RETURNING id, created_at AS "createdAt"`,
        [
          candidateId,
          companyId,
          areaId,
          topType,
          JSON.stringify(scores),
          resolvedVacancyId,
          resolvedInviteId,
          fillDurationMs,
          copyEventCount,
          attrCols.attrSource,
          attrCols.attrMedium,
          attrCols.attrCampaign,
          attrCols.attrContent,
          attrCols.attrTerm,
          attrCols.attrRef,
          attrCols.attrLanding,
          attrCols.attrSessionId,
        ]
      )
    : await query(
        `INSERT INTO assessments (candidate_id, company_id, area_id, top_type, scores, fill_duration_ms, copy_event_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at AS "createdAt"`,
        [candidateId, companyId, areaId, topType, JSON.stringify(scores), fillDurationMs, copyEventCount]
      );

  if (resolvedVacancyId) {
    scheduleJobFunnelEvent({
      companyId,
      vacancyId: resolvedVacancyId,
      eventType: 'apply_complete',
      candidateId,
      sessionId: attrCols.attrSessionId,
      source: attrCols.attrSource,
      medium: attrCols.attrMedium,
      campaign: attrCols.attrCampaign,
      referralCode: attrCols.attrRef,
    });
  }

  if (resolvedInviteId) {
    await query(
      `UPDATE candidate_invites SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [resolvedInviteId]
    );
  }

  await notifyCompanyManagers(query, {
    companyId,
    type: NOTIF.ENNEAGRAM_COMPLETED,
    entityType: 'candidate',
    entityId: candidateId,
    dedupeKey: `enneagram_completed:${assessment.rows[0].id}`,
    payload: {
      candidateId,
      assessmentId: assessment.rows[0].id,
      candidateName: safeName,
      topType,
      vacancyId: resolvedVacancyId,
    },
  });

  // Legado: `results` usa UNIQUE global em LOWER(name) — colide entre empresas/candidatos.
  // Mantido só se LEGACY_RESULTS_WRITE=true (scripts/dashboards antigos).
  if (process.env.LEGACY_RESULTS_WRITE === 'true') {
    await query(
      `INSERT INTO results (name, top_type, scores)
       VALUES ($1, $2, $3)
       ON CONFLICT (LOWER(name))
       DO UPDATE SET top_type = $2, scores = $3, created_at = NOW()`,
      [safeName, topType, JSON.stringify(scores)]
    );
  }

  return {
    ok: true,
    candidateId,
    assessmentId: assessment.rows[0].id,
    createdAt: assessment.rows[0].createdAt,
    ...(resolvedVacancyId != null ? { vacancyId: resolvedVacancyId } : {}),
  };
}
