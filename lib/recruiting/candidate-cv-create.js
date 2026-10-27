import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../identity/jwt-secret.js';
import { queryRead, withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { putObject, deleteObjectBestEffort, companyScopedObjectKey } from '../s3-object-storage.js';
import { upsertCandidate } from '../ae/candidate-upsert.js';
import { analyzeProfileDocument } from './candidate-profile-import.js';
import { prepareCandidateImportFile } from './candidate-import-file.js';
import { normalizeImportFields } from './candidate-profile-import-core.js';

const audience = 'candidate-cv-create-v1';
const failure = (errorCode) => ({ ok: false, errorCode });
const fileHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

export async function analyzeNewCandidateCv({ buffer, companyId, vacancyId, userId, locale }) {
  let file;
  try { file = await prepareCandidateImportFile(buffer); }
  catch (error) { return failure(error?.code || ERR.INVALID_CV_FILE_TYPE); }
  const analyzed = await analyzeProfileDocument({ content: file.content, locale, companyId, userId });
  if (!analyzed.ok) return analyzed;
  if (!Object.keys(analyzed.suggestions).length) return failure(ERR.CV_IMPORT_EMPTY);
  const email = analyzed.suggestions.email;
  const duplicate = email
    ? (await queryRead(
        'SELECT id, full_name AS "fullName" FROM candidates WHERE company_id = $1 AND LOWER(email) = $2 LIMIT 1',
        [companyId, email],
      )).rows[0] || null
    : null;
  const token = jwt.sign(
    { companyId, vacancyId, actorId: userId, hash: fileHash(buffer) },
    getJwtSecret(),
    { algorithm: 'HS256', audience, expiresIn: '30m' },
  );
  return { ...analyzed, duplicate, token };
}

export async function createCandidateFromCv({ buffer, companyId, vacancyId, userId, token, input }) {
  let file;
  try { file = await prepareCandidateImportFile(buffer); }
  catch (error) { return failure(error?.code || ERR.INVALID_CV_FILE_TYPE); }
  let claims;
  try {
    claims = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'], audience });
  } catch {
    return failure(ERR.CV_IMPORT_STALE);
  }
  if (
    Number(claims.companyId) !== Number(companyId) ||
    Number(claims.vacancyId) !== Number(vacancyId) ||
    Number(claims.actorId) !== Number(userId) ||
    claims.hash !== fileHash(buffer)
  ) return failure(ERR.CV_IMPORT_STALE);

  let fields;
  try {
    fields = normalizeImportFields(input, { partial: true });
  } catch (error) {
    return failure(Object.values(ERR).includes(error.message) ? error.message : ERR.INVALID_DATA);
  }
  if (!fields.fullName) return failure(ERR.CANDIDATE_NAME_REQUIRED);
  if (!fields.email) return failure(ERR.INVALID_CANDIDATE_EMAIL);
  let storedKey = null;
  try {
    const result = await withTransaction(async (db) => {
      const created = await upsertCandidate({
        companyId,
        fullName: fields.fullName,
        email: fields.email,
        profile: fields,
        createdByUserId: userId,
        db,
        rejectExisting: true,
      });
      if (!created.ok) return created;
      const candidateId = created.candidateId;
      storedKey = companyScopedObjectKey(companyId, 'candidates', String(candidateId), `${crypto.randomUUID()}.${file.extension}`);
      const uploaded = await putObject({ key: storedKey, body: buffer, contentType: file.mimeType });
      if (!uploaded?.url) throw Object.assign(new Error(ERR.STORAGE_UPLOAD_FAILED), { code: ERR.STORAGE_UPLOAD_FAILED });
      await db.query(
        `UPDATE candidates SET work_history = $2, professional_summary = $3,
           professional_summary_updated_at = CASE WHEN $3::text IS NULL THEN NULL ELSE NOW() END,
           cv_url = $4, cv_key = $5, cv_extracted_text = $6, cv_updated_at = NOW()
         WHERE id = $1 AND company_id = $7`,
        [candidateId, fields.workHistory || null, fields.professionalSummary || null,
          uploaded.url, storedKey, file.text || null, companyId],
      );
      await db.query(
        `INSERT INTO vacancy_candidates
           (vacancy_id, candidate_id, company_id, pipeline_stage, created_by_user_id)
         VALUES ($1, $2, $3, 'interview', $4)`,
        [vacancyId, candidateId, companyId, userId],
      );
      return { ok: true, candidateId, companyId };
    });
    if (!result.ok) storedKey = null;
    return result;
  } catch (error) {
    if (storedKey) await deleteObjectBestEffort(storedKey);
    if (error.code === '23505') return failure(ERR.EMAIL_TAKEN);
    throw error;
  }
}
