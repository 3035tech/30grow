/**
 * Unit proof — B-2804.1 hour bank base choice (closure snapshot vs cron checkpoint) and
 * shared cron auth.
 */
import assert from 'node:assert/strict';
import { HOUR_BANK_CHECKPOINT_RUN_CAP, pickHourBankBase } from '../../lib/people/hour-bank-balance.js';
import { hourBankCheckpointRunCap } from '../../lib/people/hour-bank-checkpoints.js';
import { verifyCronRequest } from '../../lib/cron-auth.js';

function main() {
  const snap = { balance: 100, periodEnd: '2026-08-31' };
  assert.equal(pickHourBankBase(null, null), null);
  assert.deepEqual(pickHourBankBase(snap, null), { balance: 100, day: '2026-08-31' });
  assert.deepEqual(pickHourBankBase(null, { balance: 5, asOf: '2026-09-01' }), { balance: 5, day: '2026-09-01' });
  assert.deepEqual(pickHourBankBase(snap, { balance: 5, asOf: '2026-09-02' }), { balance: 5, day: '2026-09-02' }, 'later checkpoint wins');
  assert.deepEqual(pickHourBankBase(snap, { balance: 5, asOf: '2026-08-31' }), { balance: 100, day: '2026-08-31' }, 'tie keeps the closure');
  assert.deepEqual(pickHourBankBase(snap, { balance: 5, asOf: '2026-08-01' }), { balance: 100, day: '2026-08-31' });

  assert.equal(hourBankCheckpointRunCap({}), HOUR_BANK_CHECKPOINT_RUN_CAP);
  assert.equal(hourBankCheckpointRunCap({ HOUR_BANK_CHECKPOINT_RUN_CAP: '500' }), 500);
  assert.equal(hourBankCheckpointRunCap({ HOUR_BANK_CHECKPOINT_RUN_CAP: '999999' }), 20000);
  assert.equal(hourBankCheckpointRunCap({ HOUR_BANK_CHECKPOINT_RUN_CAP: '0' }), HOUR_BANK_CHECKPOINT_RUN_CAP);
  assert.equal(hourBankCheckpointRunCap({ HOUR_BANK_CHECKPOINT_RUN_CAP: 'abc' }), HOUR_BANK_CHECKPOINT_RUN_CAP);

  const req = (headers) => ({ headers: new Headers(headers) });
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(verifyCronRequest(req({ authorization: 'Bearer x' })), false, 'no secret configured');
  process.env.CRON_SECRET = 's3';
  assert.equal(verifyCronRequest(req({ authorization: 'Bearer s3' })), true);
  assert.equal(verifyCronRequest(req({ 'x-cron-secret': 's3' })), true);
  assert.equal(verifyCronRequest(req({ authorization: 'Bearer nope' })), false);
  assert.equal(verifyCronRequest(req({ authorization: 'Bearer s3x' })), false, 'prefix match is not enough');
  assert.equal(verifyCronRequest(req({ authorization: 'Basic s3' })), false);
  assert.equal(verifyCronRequest(req({})), false);
  if (prev === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prev;

  console.log('hour-bank-checkpoint.unit.test.js OK');
}

main();
