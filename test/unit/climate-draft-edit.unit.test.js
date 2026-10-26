import test from 'node:test';
import assert from 'node:assert/strict';
import { updateClimateSurvey } from '../../lib/people/climate-surveys.js';

function fixture(status, concurrent = false) {
  const calls = [];
  let title = 'Original'; let description = '<p>Original</p>';
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('UPDATE climate_surveys')) {
      if (concurrent) return { rowCount: 0, rows: [] };
      title = params[2]; description = params[3];
      return { rowCount: 1, rows: [{ id: 1, companyId: 26, title, description, status }] };
    }
    if (sql.includes('FROM climate_surveys s')) return { rowCount: 1, rows: [{ id: 1, companyId: 26, title, description, status }] };
    if (sql.includes('FROM climate_survey_questions')) return { rows: [], rowCount: 0 };
    return { rows: [{ n: 0, total: 0, used: 0, pending: 0 }], rowCount: 1 };
  } };
  return { db, calls };
}
test('draft title and description edits are scoped and rich text is sanitized', async () => {
  const f = fixture('draft');
  const result = await updateClimateSurvey(f.db, { companyId: 26, surveyId: 1, title: 'Nova pesquisa', description: '<p>Nova descrição</p><script>alert(1)</script>' });
  assert.equal(result.ok, true); assert.equal(result.survey.title, 'Nova pesquisa'); assert.doesNotMatch(result.survey.description, /<script>/);
  const write = f.calls.find(call => call.sql.includes('UPDATE climate_surveys'));
  assert.equal(write.params[0], 1); assert.equal(write.params[1], 26); assert.equal(write.params[7], 'draft');
});
test('published, closed and archived survey content is protected', async () => {
  for (const status of ['open', 'closed', 'archived']) {
    const f = fixture(status);
    const result = await updateClimateSurvey(f.db, { companyId: 26, surveyId: 1, title: 'Changed' });
    assert.equal(result.errorCode, 'SURVEY_QUESTIONS_LOCKED'); assert.ok(f.calls.every(call => !call.sql.includes('UPDATE')));
  }
});
test('publication racing a draft edit rejects the stale edit', async () => {
  const f = fixture('draft', true);
  const result = await updateClimateSurvey(f.db, { companyId: 26, surveyId: 1, title: 'Changed' });
  assert.equal(result.errorCode, 'SURVEY_QUESTIONS_LOCKED');
});
