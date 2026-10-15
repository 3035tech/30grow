import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);
const { pool, query } = await import('../../lib/db.js');
const { analyzeCandidateProfile, applyCandidateProfile } = await import(
  '../../lib/candidate-profile-import.js'
);
const { getCandidateCv } = await import('../../lib/candidate-cv.js');
let companyId;
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
try {
  const migration = await readFile(
    new URL('../../migrations/158_candidate_profile_import.sql', import.meta.url),
    'utf8',
  );
  await query(migration);
  await query(migration);
  checks++;
  companyId = Number(
    (
      await query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id', [
        'Profile import regression',
        `cv-${Date.now()}`,
      ])
    ).rows[0].id,
  );
  const userId = Number(
    (
      await query(
        "INSERT INTO users(company_id,email,password_hash,role) VALUES($1,$2,'unusable','hr') RETURNING id",
        [companyId, `cv-${Date.now()}@dtov.invalid`],
      )
    ).rows[0].id,
  );
  const candidateId = Number(
    (
      await query(
        `INSERT INTO candidates(company_id,full_name,email,city,cv_key,cv_extracted_text) VALUES($1,'Existing name','before@dtov.invalid','Existing city','companies/test/cv.pdf',$2) RETURNING id`,
        [
          companyId,
          'Fictional Professional\nnew@dtov.invalid\nSoftware developer with experience in JavaScript, React, education in computer science, fluent Portuguese.',
        ],
      )
    ).rows[0].id,
  );
  const scope = { companyId, isAdmin: false };
  const analyze = () => analyzeCandidateProfile({ candidateId, scope, userId });
  const apply = (token, fields, extra = {}) =>
    applyCandidateProfile({ candidateId, scope, userId, body: { token, fields }, ...extra });
  check(
    (await analyzeCandidateProfile({ candidateId, scope: { companyId: companyId + 1 }, userId }))
      .errorCode === 'UNAUTHORIZED',
    'analysis blocks cross tenant',
  );
  const draft = await analyze();
  check(draft.ok && draft.suggestions.professionalSummary, 'AI supplies a reviewable summary');
  check(draft.candidateFields.email === 'before@dtov.invalid', 'current values are shown');
  const tokenPayload = JSON.parse(Buffer.from(draft.token.split('.')[1], 'base64url').toString());
  check(
    !JSON.stringify(tokenPayload).includes('@dtov.invalid'),
    'review token contains hashes, no contact data',
  );
  check(
    (await apply(draft.token, { professionalSummary: 'Reviewed summary' }, { userId: userId + 1 }))
      .errorCode === 'UNAUTHORIZED',
    'review actor bound',
  );
  check(
    (
      await apply(
        draft.token,
        { professionalSummary: 'Reviewed summary' },
        { scope: { companyId: companyId + 1 } },
      )
    ).errorCode === 'UNAUTHORIZED',
    'review tenant bound',
  );
  check(
    (await apply(draft.token + 'tampered', { professionalSummary: 'Bad' })).errorCode ===
      'CV_IMPORT_STALE',
    'tampering blocked',
  );
  check((await apply(draft.token, { email: 'invalid' })).errorCode === 'INVALID_EMAIL', 'edited email validation is actionable');
  check(
    (await apply(draft.token, { companyId: '7' })).ok === false,
    'unknown edited fields blocked',
  );
  await query("UPDATE candidates SET city='Concurrent city' WHERE id=$1", [candidateId]);
  check(
    (await apply(draft.token, { professionalSummary: 'Reviewed professional summary' })).ok,
    'unselected concurrent changes preserved',
  );
  let row = (await query('SELECT * FROM candidates WHERE id=$1', [candidateId])).rows[0];
  check(
    row.full_name === 'Existing name' &&
      row.email === 'before@dtov.invalid' &&
      row.city === 'Concurrent city',
    'nonselected fields unchanged',
  );
  check(
    row.professional_summary === 'Reviewed professional summary' &&
      row.professional_summary_updated_at,
    'reviewed summary persisted',
  );
  check(
    (await getCandidateCv({ candidateId, companyId, isAdmin: false })).professionalSummary ===
      row.professional_summary,
    'summary visible on CV block',
  );
  check(
    (await apply(draft.token, { professionalSummary: 'Replay' })).errorCode === 'CV_IMPORT_STALE',
    'replay after edit blocked',
  );
  const staleField = await analyze();
  await query("UPDATE candidates SET email='concurrent@dtov.invalid' WHERE id=$1", [candidateId]);
  check(
    (await apply(staleField.token, { email: 'selected@dtov.invalid' })).errorCode ===
      'CV_IMPORT_STALE',
    'selected field conflict blocked',
  );
  const staleCv = await analyze();
  await query("UPDATE candidates SET cv_key='replacement.pdf' WHERE id=$1", [candidateId]);
  check(
    (await apply(staleCv.token, { professionalSummary: 'Wrong source' })).errorCode ===
      'CV_IMPORT_STALE',
    'replaced CV invalidates review',
  );
  await query('UPDATE candidates SET cv_key=NULL WHERE id=$1', [candidateId]);
  check((await analyze()).errorCode === 'CV_IMPORT_EMPTY', 'missing document actionable');
  check(
    (await getCandidateCv({ candidateId, companyId, isAdmin: false })).professionalSummary ===
      row.professional_summary,
    'removing source retains reviewed profile',
  );
  await query(
    "UPDATE candidates SET cv_key='replacement.pdf',employment_status='employee' WHERE id=$1",
    [candidateId],
  );
  check(
    (await analyze()).errorCode === 'INVALID_DATA',
    'employee lifecycle not changed by candidate import',
  );
  await query("UPDATE candidates SET employment_status='candidate' WHERE id=$1", [candidateId]);
  process.env.AI_ENABLED = '0';
  check((await analyze()).errorCode === 'RUBRIC_AI_NOT_CONFIGURED', 'kill switch respected');
  delete process.env.AI_ENABLED;
  await query('UPDATE companies SET ai_monthly_call_limit=0 WHERE id=$1', [companyId]);
  await assert.rejects(analyze(), (error) => error.code === 'AI_MONTHLY_LIMIT');
  checks++;
  check(
    Number(
      (
        await query(
          "SELECT COUNT(*) AS n FROM ai_usage_events WHERE company_id=$1 AND feature='cv_profile_import'",
          [companyId],
        )
      ).rows[0].n,
    ) >= 3,
    'usage attributed to import',
  );
  console.log(`Candidate profile import: ${checks} checks passed`);
} finally {
  if (companyId) {
    await query('DELETE FROM users WHERE company_id=$1', [companyId]);
    await query('DELETE FROM companies WHERE id=$1', [companyId]);
  }
  await pool.end();
}
