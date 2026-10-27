/**
 * Smoke B-2000 — culture summary snippet + talent bank topType param shape.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { relativeWeightsToPercentRubric } from '../../lib/recruiting/rubric-prompt.js';

describe('b2000 helpers still importable', () => {
  it('relativeWeightsToPercentRubric sanity (shared util)', () => {
    const out = relativeWeightsToPercentRubric({ 3: 2, 5: 1 });
    assert.equal(Object.values(out).reduce((a, b) => a + b, 0), 100);
  });
});
