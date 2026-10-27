import assert from 'node:assert/strict';
import test from 'node:test';

import { mobileIdempotencyKey } from '../../lib/mobile/mobile-idempotency.js';

function requestWith(value) { return { headers: { get: (name) => name === 'idempotency-key' ? value : null } }; }

test('accepts opaque bounded mobile idempotency keys', () => {
  assert.equal(mobileIdempotencyKey(requestWith('123e4567-e89b-12d3-a456-426614174000')), '123e4567-e89b-12d3-a456-426614174000');
});

test('rejects missing, short, or unsafe idempotency keys', () => {
  assert.equal(mobileIdempotencyKey(requestWith(null)), null);
  assert.equal(mobileIdempotencyKey(requestWith('short')), null);
  assert.equal(mobileIdempotencyKey(requestWith('unsafe key with spaces')), null);
});
