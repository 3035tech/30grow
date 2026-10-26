import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOnboardingProgress, ONBOARDING_TASKS } from '../../lib/development/onboarding-progress.js';

describe('onboarding progress', () => {
  it('uses the persisted assessment result instead of a nonexistent completed_at column', async () => {
    const queries = [];
    const fakeQuery = async (sql, params) => {
      queries.push(String(sql));
      assert.deepEqual(params, [42]);
      return { rows: [{ exists: String(sql).includes('ass.top_type IS NOT NULL'), n: 0 }] };
    };

    const result = await getOnboardingProgress(fakeQuery, 42);
    const sql = queries.join('\n');

    assert.equal(queries.length, 7);
    assert.doesNotMatch(sql, /ass\.completed_at/);
    assert.match(sql, /ass\.top_type IS NOT NULL/);
    assert.ok(result.completed.includes(ONBOARDING_TASKS.VIEW_RESULT.id));
  });
});
