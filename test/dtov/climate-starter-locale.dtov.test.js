/** Starter questionnaire proof against disposable DTOV PostgreSQL only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dtovEnv, assertDtovTarget } from './harness.js';

const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);

const { pool } = await import('../../lib/db.js');
const { createClimateSurvey, updateClimateSurvey } = await import('../../lib/people/climate-surveys.js');
const client = await pool.connect();

try {
  await client.query('BEGIN');
  const companyId = (await client.query(
    'INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',
    ['Climate locale proof', `climate-locale-${randomUUID().slice(0, 8)}`]
  )).rows[0].id;

  const english = await createClimateSurvey(client, { companyId, title: 'Team climate', locale: 'en' });
  assert.equal(english.ok, true);
  assert.equal(english.survey.questions.length, 7);
  assert.match(english.survey.questions[0].prompt, /Overall/);
  assert.equal(english.survey.questions[5].questionKind, 'text');

  const blank = await createClimateSurvey(client, { companyId, title: 'Blank draft', locale: 'en', seedDefaultQuestions: false });
  assert.equal(blank.ok, true);
  assert.equal(blank.survey.questions.length, 0);
  const opening = await updateClimateSurvey(client, { companyId, surveyId: blank.survey.id, status: 'open' });
  assert.equal(opening.ok, false, 'a questionnaire with no questions cannot open');

  const directOpen = await createClimateSurvey(client, { companyId, title: 'Blank open', status: 'open', seedDefaultQuestions: false });
  assert.equal(directOpen.ok, false);
  process.stdout.write('climate starter locale DTOV: ok\n');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
