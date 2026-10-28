/** Local DTOV only: public application profile, CV handoff and confirmation. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dtovEnv, assertDtovTarget } from '../dtov/harness.js';

assert.equal(process.env.PUBLIC_APPLY_PROFILE_TEST, '1', 'Explicit local test opt-in required');
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);

const { pool } = await import('../../lib/db.js');
const { applyToPublicVacancy } = await import('../../lib/public-vacancy-apply.js');
const { ERR } = await import('../../lib/api-error-codes.js');
const email = `public-apply-${randomUUID()}@example.test`;
let candidateId;
let companyId;

try {
  companyId = (await pool.query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', ['DTOV public application', `dtov-apply-${randomUUID()}`])).rows[0].id;
  const vacancy = (await pool.query(
    `INSERT INTO vacancies(company_id,title,slug,status,public_page_enabled)
     VALUES($1,'DTOV public role',$2,'open',true) RETURNING id,company_id AS "companyId"`,
    [companyId, `dtov-role-${randomUUID()}`]
  )).rows[0];
  const file = { buffer: Buffer.from('%PDF-1.4\nsynthetic'), mimeType: 'application/pdf', size: 18 };
  const uploads = [];
  const mails = [];
  const deps = {
    storageConfigured: () => true,
    mailConfigured: () => true,
    uploadCv: async options => { uploads.push(options); return { ok: true }; },
    sendMail: async mail => { mails.push(mail); return { ok: true }; },
  };
  const input = {
    vacancyId: vacancy.id,
    fullName: 'Candidatura Sintética',
    email,
    consent: true,
    linkedinUrl: 'linkedin.com/in/candidatura-sintetica',
    cvFile: file,
    locale: 'pt-BR',
  };
  const invalid = await applyToPublicVacancy({ ...input, linkedinUrl: 'https://other.example/profile' }, deps);
  assert.equal(invalid.errorCode, ERR.INVALID_DATA);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM candidates WHERE company_id=$1 AND email=$2', [vacancy.companyId, email])).rows[0].n, 0);

  const created = await applyToPublicVacancy(input, deps);
  assert.equal(created.ok, true);
  assert.equal(created.alreadyLinked, false);
  assert.equal(created.confirmationSent, true);
  candidateId = created.candidateId;
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].candidateId, candidateId);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, email);
  assert.match(mails[0].subject, /Candidatura recebida/);
  const person = (await pool.query('SELECT linkedin_url, consent_at FROM candidates WHERE id=$1 AND company_id=$2', [candidateId, vacancy.companyId])).rows[0];
  assert.equal(person.linkedin_url, 'https://linkedin.com/in/candidatura-sintetica');
  assert.ok(person.consent_at);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM vacancy_candidates WHERE vacancy_id=$1 AND candidate_id=$2', [vacancy.id, candidateId])).rows[0].n, 1);

  const retry = await applyToPublicVacancy(input, deps);
  assert.equal(retry.alreadyLinked, true);
  assert.equal(uploads.length, 1, 'retry does not replace the CV');
  assert.equal(mails.length, 1, 'retry does not repeat the email');
  console.log('public-vacancy-apply-profile.test.js: ok');
} finally {
  if (companyId) await pool.query('DELETE FROM companies WHERE id=$1', [companyId]);
  await pool.end();
}
