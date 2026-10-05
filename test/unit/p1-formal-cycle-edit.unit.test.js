import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updateFormalReviewCycle, createFormalReviewCycle, resolveFormalRaterByToken, submitManagerRatings } from '../../lib/people/formal-competency-reviews.js';

const draft = { id: 1, status: 'draft', title: 'Cycle', model: '90', includeSelf: false, periodStart: '2026-09-01', periodEnd: '2026-09-30', questionnaire: [], instructions: '' };
test('authenticated manager cannot bypass closed, scheduled or expired cycle gates', async () => {
  for (const cycle of [{ status: 'closed', periodStart: '2020-01-01', periodEnd: '2099-01-01' }, { status: 'open', periodStart: '2099-01-01', periodEnd: '2099-02-01' }, { status: 'open', periodStart: '2020-01-01', periodEnd: '2020-02-01' }]) {
    const db = { query: async sql => { assert.match(sql, /FOR UPDATE OF cy/); return { rowCount: 1, rows: [cycle] }; } };
    assert.equal((await submitManagerRatings(db, { companyId: 1, reviewId: 1, managerUserId: 1, scores: [] })).ok, false);
  }
});
test('cycle configuration cannot change after publication or bypass publish validation', async () => {
  for (const patch of [{ title: 'Changed' }, { periodEnd: '2027-01-01' }, { questionnaire: [] }]) {
    const db = { query: async () => ({ rowCount: 1, rows: [{ ...draft, status: 'open' }] }) };
    assert.equal((await updateFormalReviewCycle(db, { companyId: 1, cycleId: 1, ...patch })).ok, false);
  }
  const db = { query: async () => ({ rowCount: 1, rows: [draft] }) };
  assert.equal((await updateFormalReviewCycle(db, { companyId: 1, cycleId: 1, status: 'open' })).ok, false);
});
test('draft rejects impossible dates and reversed ranges before writing', async () => {
  const db = { query: async sql => { assert.match(sql, /^SELECT/); return { rowCount: 1, rows: [draft] }; } };
  for (const patch of [{ periodStart: '2026-02-30' }, { periodStart: '2026-10-01' }, { periodEnd: 'invalid' }]) {
    assert.equal((await updateFormalReviewCycle(db, { companyId: 1, cycleId: 1, ...patch })).ok, false);
  }
  assert.equal((await createFormalReviewCycle(db, { companyId: 1, title: 'Invalid', periodStart: '2026-02-30' })).ok, false);
});
test('closed cycle rejects even an otherwise collecting public questionnaire', async () => {
  const db = { query: async () => ({ rowCount: 1, rows: [{ cycleStatus: 'closed', reviewStatus: 'collecting', role: 'self' }] }) };
  assert.equal((await resolveFormalRaterByToken(db, 'test-token-long-enough')).ok, false);
});
test('editing questionnaire keeps its snapshot and refreshes only draft review items', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('FROM formal_review_cycles')) return { rowCount: 1, rows: [{ ...draft, questionnaire: [{ competencyId: 7, label: 'Original', description: 'Historical wording', selfDescription: '' }] }] };
    if (sql.includes('FROM company_competencies')) return { rowCount: 1, rows: [{ id: 7, name: 'Changed catalog', description: 'New wording' }] };
    if (sql.startsWith('UPDATE formal_review_cycles')) return { rowCount: 1, rows: [{ ...draft }] };
    if (sql.includes('SELECT id FROM formal_reviews')) return { rowCount: 1, rows: [{ id: 8 }] };
    return { rowCount: 1, rows: [] };
  } };
  const result = await updateFormalReviewCycle(db, { companyId: 2, cycleId: 1, questionnaire: [{ competencyId: 7, selfDescription: 'Reviewed first person' }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cycle.questionnaire[0], { competencyId: 7, label: 'Original', description: 'Historical wording', selfDescription: 'Reviewed first person' });
  const inserted = calls.find(call => call.sql.startsWith('INSERT INTO formal_review_items'));
  assert.deepEqual(inserted.params, [[8], 2, [7], ['Original'], ['Historical wording'], ['Reviewed first person']]);
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO formal_review_items')).length, 1, 'one insert for every draft review');
});
