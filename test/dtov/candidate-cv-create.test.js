import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { profilePdf } from '../fixtures/profile-pdf.js';
import { dtovEnv, assertDtovTarget } from './harness.js';

const env = dtovEnv({ OPENAI_MOCK: '1' });
assertDtovTarget(env);
Object.assign(process.env, env);
const requests = [];
let failUploads = false;
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url });
  request.resume();
  request.on('end', () => {
    response.writeHead(failUploads && request.method === 'PUT' ? 403 : 200);
    response.end();
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
Object.assign(process.env, {
  S3_BUCKET: 'dtov-cv', S3_REGION: 'us-east-1', S3_ENDPOINT: endpoint,
  S3_ACCESS_KEY_ID: 'dtov', S3_SECRET_ACCESS_KEY: 'dtov-secret',
  S3_PUBLIC_BASE_URL: endpoint,
});

const { query, pool } = await import('../../lib/db.js');
const { analyzeNewCandidateCv, createCandidateFromCv } = await import('../../lib/recruiting/candidate-cv-create.js');
const fixture = (await query(
  `SELECT u.id AS "userId", c.id AS "companyId", v.id AS "vacancyId"
   FROM companies c JOIN users u ON u.company_id=c.id
   JOIN vacancies v ON v.company_id=c.id
   WHERE c.name='Synthetic admission' ORDER BY c.id, v.id LIMIT 1`,
)).rows[0];
assert.ok(fixture, 'DTOV synthetic admission fixture must include a user and vacancy');
const companyId = Number(fixture.companyId);
const userId = Number(fixture.userId);
const vacancyId = Number(fixture.vacancyId);
const email = `cv-first-${Date.now()}@dtov.invalid`;
const buffer = profilePdf(['Synthetic Candidate', email, 'Software development and education experience since 2020.', 'Skills: JavaScript and PostgreSQL.']);
const common = { buffer, companyId, vacancyId, userId };
let createdId;
let textCreatedId;
try {
  const draft = await analyzeNewCandidateCv(common);
  assert.equal(draft.ok, true);
  assert.equal(draft.suggestions.email, email);
  assert.equal(draft.duplicate, null);
  const input = { fullName: 'Synthetic Candidate', email, professionalSummary: 'Reviewed professional experience' };
  assert.equal((await createCandidateFromCv({ ...common, token: `${draft.token}x`, input })).errorCode, 'CV_IMPORT_STALE');
  assert.equal((await createCandidateFromCv({ ...common, userId: userId + 1, token: draft.token, input })).errorCode, 'CV_IMPORT_STALE');
  assert.equal((await createCandidateFromCv({ ...common, buffer: profilePdf(['different']), token: draft.token, input })).errorCode, 'CV_IMPORT_STALE');
  assert.equal((await createCandidateFromCv({ ...common, token: draft.token, input: { email } })).errorCode, 'CANDIDATE_NAME_REQUIRED');
  assert.equal(Number((await query('SELECT COUNT(*) AS n FROM candidates WHERE company_id=$1 AND email=$2', [companyId, email])).rows[0].n), 0);

  const result = await createCandidateFromCv({ ...common, token: draft.token, input });
  assert.equal(result.ok, true);
  createdId = result.candidateId;
  const candidate = (await query('SELECT * FROM candidates WHERE id=$1 AND company_id=$2', [createdId, companyId])).rows[0];
  assert.equal(candidate.full_name, input.fullName);
  assert.equal(candidate.email, email);
  assert.equal(candidate.professional_summary, input.professionalSummary);
  assert.equal(candidate.consent_at, null);
  assert.ok(candidate.cv_key?.includes(`/candidates/${createdId}/`));
  assert.ok(candidate.cv_extracted_text?.includes(email));
  assert.equal(Number((await query('SELECT COUNT(*) AS n FROM vacancy_candidates WHERE vacancy_id=$1 AND candidate_id=$2', [vacancyId, createdId])).rows[0].n), 1);
  assert.equal(requests.filter((entry) => entry.method === 'PUT').length, 1);

  assert.equal((await createCandidateFromCv({ ...common, token: draft.token, input: { ...input, fullName: 'Changed name' } })).errorCode, 'EMAIL_TAKEN');
  assert.equal((await query('SELECT full_name FROM candidates WHERE id=$1', [createdId])).rows[0].full_name, input.fullName);
  assert.equal((await analyzeNewCandidateCv(common)).duplicate.id, createdId);
  const textEmail = `cv-text-${Date.now()}@dtov.invalid`;
  const textBuffer = Buffer.from(`Text Candidate\n${textEmail}\nProfessional experience in operations since 2020.`, 'utf8');
  const textDraft = await analyzeNewCandidateCv({ ...common, buffer: textBuffer });
  assert.equal(textDraft.ok, true);
  const textResult = await createCandidateFromCv({ ...common, buffer: textBuffer, token: textDraft.token,
    input: { fullName: 'Text Candidate', email: textEmail } });
  assert.equal(textResult.ok, true);
  textCreatedId = textResult.candidateId;
  const textCandidate = (await query('SELECT cv_key, cv_extracted_text FROM candidates WHERE id=$1', [textCreatedId])).rows[0];
  assert.ok(textCandidate.cv_key.endsWith('.txt'));
  assert.ok(textCandidate.cv_extracted_text.includes(textEmail));
  const failedEmail = `cv-failed-${Date.now()}@dtov.invalid`;
  const failedBuffer = profilePdf(['Failed upload', failedEmail, 'Professional experience in operations since 2020.']);
  const failedDraft = await analyzeNewCandidateCv({ ...common, buffer: failedBuffer });
  failUploads = true;
  await assert.rejects(
    createCandidateFromCv({ ...common, buffer: failedBuffer, token: failedDraft.token,
      input: { fullName: 'Failed upload', email: failedEmail } }),
    (error) => error.code === 'STORAGE_UPLOAD_FAILED',
  );
  failUploads = false;
  assert.equal(Number((await query('SELECT COUNT(*) AS n FROM candidates WHERE company_id=$1 AND email=$2', [companyId, failedEmail])).rows[0].n), 0);
  console.log('Candidate CV first: review, token binding, atomic create, duplicate and replay passed');
} finally {
  if (createdId) await query('DELETE FROM candidates WHERE id=$1 AND company_id=$2', [createdId, companyId]);
  if (textCreatedId) await query('DELETE FROM candidates WHERE id=$1 AND company_id=$2', [textCreatedId, companyId]);
  await pool.end();
  await new Promise((resolve) => server.close(resolve));
}
