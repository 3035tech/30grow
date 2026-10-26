import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRubric } from '../../lib/recruiting/job-role-rubric.js';
import { computeAreaScore010 } from '../../lib/assessment/area-fit.js';

test('legacy job-role weights reopen without loss, rescaling or mutation', () => {
  const legacy = Object.freeze({ 1: 2, 3: 2, 5: 3, 6: 1 });
  const canonical = normalizeRubric(legacy);
  assert.deepEqual(canonical, { T1: 2, T3: 2, T5: 3, T6: 1 });
  assert.deepEqual(normalizeRubric(canonical), canonical);
  const scores = { 1: 28, 2: 12, 3: 15, 4: 15, 5: 18, 6: 18, 7: 9, 8: 11, 9: 13 };
  assert.deepEqual(computeAreaScore010(scores, canonical, { withBreakdown: true }), computeAreaScore010(scores, legacy, { withBreakdown: true }));
});

test('canonical weights take precedence, including explicit zero; totals remain independent', () => {
  assert.deepEqual(normalizeRubric({ 1: 2, T1: 0, 2: 3, T2: 80, T3: 25.5, T4: 95 }), { T1: 0, T2: 80, T3: 26, T4: 95 });
  assert.deepEqual(computeAreaScore010({ 1: 30, 2: 10 }, { 1: 3, T1: 0, T2: 80 }), computeAreaScore010({ 1: 30, 2: 10 }, { 2: 80 }));
});

test('invalid weights remain excluded and the normalizer is idempotent', () => {
  for (const input of [null, [], 'bad', { T1: -1, T2: Infinity, T3: 101, T4: 'bad', T10: 9 }]) assert.deepEqual(normalizeRubric(input), {});
  assert.deepEqual(normalizeRubric({ 1: '2', T2: '30.4' }), { T1: 2, T2: 30 });
});
