/**
 * Soft apply from the public vacancy page (/jobs/…): name + email + consent →
 * vacancy_candidates at pipeline "new", without starting an assessment.
 */

import { query } from './db.js';
import { ERR } from './api-error-codes.js';
import { upsertCandidatePreInterview } from './ae/candidate-upsert.js';
import { normalizeCandidateProfile } from './recruiting/candidate-profile.js';
import { PIPELINE_STAGE } from './recruiting/pipeline.js';
import { VACANCY_STATUS } from './domain-status.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {{
 *   vacancyId: number,
 *   fullName: string,
 *   email: string,
 *   consent: boolean,
 *   phone?: string|null,
 * }} input
 * @returns {Promise<
 *   | { ok: true, alreadyLinked: boolean, candidateId: number, vacancyId: number }
 *   | { ok: false, errorCode: string }
 * >}
 */
export async function applyToPublicVacancy(input) {
  const vacancyId = Number(input?.vacancyId);
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_VACANCY };
  }

  if (!input?.consent) {
    return { ok: false, errorCode: ERR.CONSENT_REQUIRED };
  }

  const fullName = String(input.fullName || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  if (!fullName || fullName.length > 200) {
    return { ok: false, errorCode: ERR.CANDIDATE_NAME_REQUIRED };
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, errorCode: ERR.INVALID_CANDIDATE_EMAIL };
  }

  const vac = await query(
    `SELECT v.id, v.company_id AS "companyId", v.title, v.status,
            v.public_page_enabled AS "publicPageEnabled"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE v.id = $1
       AND v.deleted = FALSE
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND v.public_page_enabled = TRUE
     LIMIT 1`,
    [vacancyId]
  );
  if (vac.rowCount === 0) {
    return { ok: false, errorCode: ERR.NOT_FOUND };
  }
  const vacancy = vac.rows[0];
  if (String(vacancy.status) !== VACANCY_STATUS.OPEN) {
    return { ok: false, errorCode: ERR.VACANCY_CLOSED };
  }

  const up = await upsertCandidatePreInterview({
    companyId: vacancy.companyId,
    fullName,
    email,
    profile: normalizeCandidateProfile({
      phone: input.phone || null,
      source: 'job_board',
    }),
  });
  if (!up.ok) {
    return { ok: false, errorCode: up.errorCode || ERR.INVALID_DATA };
  }

  const prior = await query(
    `SELECT id FROM vacancy_candidates WHERE vacancy_id = $1 AND candidate_id = $2 LIMIT 1`,
    [vacancy.id, up.candidateId]
  );
  const alreadyLinked = prior.rowCount > 0;

  await query(
    `INSERT INTO vacancy_candidates (
       vacancy_id, candidate_id, company_id, pipeline_stage
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (vacancy_id, candidate_id)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [vacancy.id, up.candidateId, vacancy.companyId, PIPELINE_STAGE.NEW]
  );

  await query(
    `UPDATE candidates SET consent_at = COALESCE(consent_at, NOW()) WHERE id = $1 AND company_id = $2`,
    [up.candidateId, vacancy.companyId]
  );

  return {
    ok: true,
    alreadyLinked,
    candidateId: up.candidateId,
    vacancyId: vacancy.id,
  };
}
