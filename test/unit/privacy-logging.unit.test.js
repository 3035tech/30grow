import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveValue } from '../../lib/identity/redact-secrets.js';
import { logger, withApiLogging, getMetricsSnapshot, resetMetrics } from '../../lib/monitoring.js';

test('sensitive nested fields are removed without hiding operational evidence', () => {
  const clean = redactSensitiveValue({ companyId: 8, status: 400, nested: [{ password: 'private', cpf: '123', answers: [1,2], sqlPreview: 'secret SQL', error: 'contains private value', email: 'a@example.test' }] });
  assert.equal(clean.companyId, 8);
  assert.equal(clean.status, 400);
  assert.ok(Object.values(clean.nested[0]).every(v => v === '[redacted]'));
});

test('actual logger and request metrics do not retain public access tokens', async () => {
  const lines = [];
  const previousLog = console.log, previousError = console.error;
  console.log = line => lines.push(line);
  console.error = line => lines.push(line);
  try {
    resetMetrics();
    logger.warn('Synthetic failure', { code: '23505', body: { sensitive: 'private-marker' }, params: ['private-marker'] });
    await withApiLogging(new Request('https://example.test/v/private-marker'), async () => new Response('ok'));
    const evidence = JSON.stringify({ lines, metrics: getMetricsSnapshot() });
    assert.ok(!evidence.includes('private-marker'));
    assert.ok(evidence.includes('23505'));
    assert.ok(evidence.includes('[redacted]'));
  } finally { console.log = previousLog; console.error = previousError; resetMetrics(); }
});
