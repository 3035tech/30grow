import assert from 'node:assert/strict';
import { pool } from '../../lib/db.js';
import { hourBankParticipantOn, loadHourBankParticipation, loadHourBankParticipationOverview, saveHourBankParticipation } from '../../lib/people/hour-bank-participation.js';

if (process.env.DTOV !== '1' || process.env.POSTGRES_DB !== 'enneagram_dtov' || process.env.POSTGRES_PORT !== '55432') {
  throw new Error('This test only runs against the local DTOV database.');
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  const person = await client.query(
    `SELECT company_id AS "companyId", id AS "candidateId"
     FROM candidates WHERE employment_status = 'employee' ORDER BY id LIMIT 1`
  );
  assert.ok(person.rowCount, 'DTOV employee seed required');
  const { companyId, candidateId } = person.rows[0];
  const validFrom = '2035-01-01';
  const saved = await saveHourBankParticipation(client, {
    companyId, candidateId, validFrom, enabled: false,
  });
  assert.equal(saved.ok, true);
  const rows = await loadHourBankParticipation(client, {
    companyId, candidateIds: [candidateId], upTo: '2035-01-02',
  });
  assert.equal(hourBankParticipantOn(rows.get(Number(candidateId)), '2034-12-31'), true);
  assert.equal(hourBankParticipantOn(rows.get(Number(candidateId)), '2035-01-01'), false);
  const before = await loadHourBankParticipationOverview(client, {
    companyId, candidateIds: [candidateId], day: '2034-12-31',
  });
  assert.deepEqual(before.get(Number(candidateId)), {
    enabled: true, next: { validFrom, enabled: false },
  });
  const after = await loadHourBankParticipationOverview(client, {
    companyId, candidateIds: [candidateId], day: validFrom,
  });
  assert.deepEqual(after.get(Number(candidateId)), { enabled: false, next: null });
  const otherCompany = await saveHourBankParticipation(client, {
    companyId: Number(companyId) + 1000000, candidateId, validFrom, enabled: true,
  });
  assert.equal(otherCompany.ok, false);
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
