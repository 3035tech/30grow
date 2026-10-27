import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loadInternalTeamRoster } from '../../lib/people/internal-team-roster.js';

it('lists a registered employee even without a profile assessment', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1
      ? { rows: [{ total: 1 }] }
      : { rows: [{ candidateId: 151, assessmentId: null, name: 'Bruna Zerbin' }] };
  };

  const result = await loadInternalTeamRoster(query, {
    companyId: 3,
    nameSearch: 'Bruna Zerbin',
    page: 4,
    pageSize: 20,
  });

  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.rows[0].assessmentId, null);
  assert.match(calls[0].sql, /c\.company_id = \$1/);
  assert.match(calls[0].sql, /c\.employment_status = 'employee'/);
  assert.match(calls[1].sql, /LEFT JOIN LATERAL/);
  assert.deepEqual(calls[1].params, [3, '%Bruna Zerbin%', 20, 0]);
});
