/**
 * Unit: relativeWeightsToPercentRubric + job-role AI conversion seam.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relativeWeightsToPercentRubric } from '../../lib/recruiting/rubric-prompt.js';

describe('relativeWeightsToPercentRubric', () => {
  it('maps relative 0–3 weights to T1–T9 percents summing to 100', () => {
    const out = relativeWeightsToPercentRubric({
      1: 0,
      3: 3,
      5: 2,
      8: 1,
    });
    assert.equal(Object.keys(out).sort().join(','), 'T3,T5,T8');
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.ok(out.T3 > out.T5);
    assert.ok(out.T5 > out.T8);
  });

  it('accepts T-prefixed keys and ignores zeros', () => {
    const out = relativeWeightsToPercentRubric({ T2: 1, T9: 1, T1: 0 });
    assert.equal(Object.keys(out).sort().join(','), 'T2,T9');
    assert.equal(out.T2 + out.T9, 100);
  });

  it('returns empty for empty / all-zero', () => {
    assert.deepEqual(relativeWeightsToPercentRubric({}), {});
    assert.deepEqual(relativeWeightsToPercentRubric({ 1: 0, 2: 0 }), {});
    assert.deepEqual(relativeWeightsToPercentRubric(null), {});
  });
});
