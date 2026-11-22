import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOnboardingProgress, ONBOARDING_TASKS } from '../../lib/development/onboarding-progress.js';
import { climateMinResponses } from '../../lib/people/climate-response-threshold.js';

describe('onboarding progress', () => {
  it('uses the persisted assessment result instead of a nonexistent completed_at column', async () => {
    const queries = [];
    const fakeQuery = async (sql, params) => {
      queries.push(String(sql));
      assert.equal(params[0], 42);
      assert.equal(params.length, String(sql).includes('climateResultsAvailable') ? 2 : 1);
      if (String(sql).includes('climateResultsAvailable')) assert.equal(params[1], climateMinResponses());
      return { rows: [{ exists: String(sql).includes('ass.top_type IS NOT NULL'), n: 0 }] };
    };

    const result = await getOnboardingProgress(fakeQuery, 42);
    const sql = queries.join('\n');

    assert.equal(queries.length, 8);
    assert.doesNotMatch(sql, /ass\.completed_at/);
    assert.match(sql, /ass\.top_type IS NOT NULL/);
    assert.match(sql, /FROM job_roles WHERE company_id=\$1 AND active=TRUE/);
    assert.match(sql, /COUNT\(\*\) >= \$2\) AS "climateResultsAvailable"/);
    assert.ok(result.completed.includes(ONBOARDING_TASKS.VIEW_RESULT.id));
  });
});
