/**
 * Soft apply from the public vacancy page (/jobs/…): contact + optional CV →
 * vacancy_candidates at pipeline "new", without starting an assessment.
 */

import { query } from './db.js';
import { ERR } from './api-error-codes.js';
import { upsertCandidatePreInterview } from './ae/candidate-upsert.js';
import { normalizeCandidateProfile } from './recruiting/candidate-profile.js';
import { normalizeImportFields } from './recruiting/candidate-profile-import-core.js';
import { assertValidCvPdfFile, isCvStorageConfigured, uploadCandidateCv } from './recruiting/candidate-cv.js';
import { isMailConfigured, sendTransactionalMail } from './mail.js';
import { t } from './i18n.js';
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
 *   linkedinUrl?: string|null,
 *   cvFile?: {buffer: Buffer, mimeType?: string, size?: number}|null,
 *   locale?: string,
 * }} input
 * @returns {Promise<
 *   | { ok: true, alreadyLinked: boolean, candidateId: number, vacancyId: number }
 *   | { ok: false, errorCode: string }
 * >}
 */
export async function applyToPublicVacancy(input, {
  uploadCv = uploadCandidateCv,
  sendMail = sendTransactionalMail,
  storageConfigured = isCvStorageConfigured,
  mailConfigured = isMailConfigured,
} = {}) {
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
  let linkedinUrl = null;
  if (String(input.linkedinUrl || '').trim()) {
    try {
      linkedinUrl = normalizeImportFields({ linkedinUrl: input.linkedinUrl }, { partial: true }).linkedinUrl;
    } catch {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
  }
  if (input.cvFile) {
    try {
      assertValidCvPdfFile(input.cvFile);
    } catch (error) {
      return { ok: false, errorCode: error.code || ERR.INVALID_CV_FILE_TYPE };
    }
    if (!storageConfigured()) return { ok: false, errorCode: ERR.STORAGE_NOT_CONFIGURED };
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
  const existing = await query(
    `SELECT employment_status FROM candidates
     WHERE company_id=$1 AND (LOWER(email)=$2 OR LOWER(personal_email)=$2)
     LIMIT 2`,
    [vacancy.companyId, email]
  );
  if (existing.rows.some(row => row.employment_status !== 'candidate')) {
    return { ok: false, errorCode: ERR.EMAIL_TAKEN };
  }

  const up = await upsertCandidatePreInterview({
    companyId: vacancy.companyId,
    fullName,
    email,
    profile: normalizeCandidateProfile({
      phone: input.phone || null,
      linkedinUrl,
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
  if (!alreadyLinked && input.cvFile) {
    const cv = await uploadCv({ candidateId: up.candidateId, companyId: vacancy.companyId, file: input.cvFile });
    if (!cv.ok) return { ok: false, errorCode: cv.errorCode || ERR.STORAGE_UPLOAD_FAILED };
  }

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

  let confirmationSent = false;
  if (!alreadyLinked && mailConfigured()) {
    try {
      await sendMail({
        to: email,
        subject: t(input.locale || 'pt-BR', 'publicVacancy.applyEmailSubject', { title: vacancy.title }),
        text: t(input.locale || 'pt-BR', 'publicVacancy.applyEmailBody', { title: vacancy.title }),
      });
      confirmationSent = true;
    } catch (error) {
      console.error('Public vacancy confirmation email failed', error);
    }
  }

  return {
    ok: true,
    alreadyLinked,
    candidateId: up.candidateId,
    vacancyId: vacancy.id,
    confirmationSent,
  };
}
