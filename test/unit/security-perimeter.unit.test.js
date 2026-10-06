import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildDefaultContentSecurityPolicy, applyContentSecurityPolicyHeaders } from '../../lib/security-csp.js';

async function rateFixture(redisEnabled = false) {
  const events = [];
  const metrics = [];
  const calls = [];
  class Redis {
    status = 'ready';
    count = 0;
    on() {}
    async eval(script, keys, key, expiry) {
      calls.push({ script, keys, key, expiry });
      return ++this.count;
    }
    async pttl() { return 60000; }
  }
  const context = vm.createContext({
    process: { env: redisEnabled ? { REDIS_URL: 'redis://example.invalid' } : {} },
    Date, Map, Number, String, URL,
  });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../lib/rate-limit.js', import.meta.url), 'utf8'), { context });
  const deps = { default: Redis, createHash,
    logger: { info() {}, warn: (...args) => events.push(args) },
    incrementMetric: (...args) => metrics.push(args),
  };
  await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [name, value] of Object.entries(deps)) this.setExport(name, value);
  }, { context }));
  await mod.evaluate();
  return { api: mod.namespace, events, metrics, calls };
}

test('account normalization shares one bucket across IPs/web/mobile without storing email', async () => {
  const { api } = await rateFixture();
  const key = api.accountRateLimitKey('employee-login', ' Alice@Example.com ');
  assert.equal(key, api.accountRateLimitKey('employee-login', 'alice@example.com'));
  assert.notEqual(key, api.accountRateLimitKey('manager-login', 'alice@example.com'));
  assert.ok(!key.includes('alice'));
  for (let i = 0; i < 12; i++) assert.equal((await api.checkRateLimit(key, 12, 900000)).ok, true);
  assert.equal((await api.checkRateLimit(key, 12, 900000)).ok, false);
});

test('Redis increment and expiry use one atomic command; denials emit redacted events and metrics', async () => {
  const { api, events, metrics, calls } = await rateFixture(true);
  const key = 'private-account@example.com';
  assert.equal((await api.checkRateLimit(key, 1, 60000)).ok, true);
  const denied = await api.checkRateLimit(key, 1, 60000);
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterSec, 60);
  assert.match(calls[0].script, /INCR/);
  assert.match(calls[0].script, /PEXPIRE/);
  assert.equal(calls[0].keys, 1);
  assert.equal(events[0][1].backend, 'redis');
  assert.ok(!JSON.stringify(events).includes(key));
  assert.equal(metrics[0][1], 'rate_limit_blocked');
});

test('production CSP permits matching nonce, rejects inline/eval, and enforces when enabled', () => {
  const old = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_CSP = 'true';
    process.env.CSP_REPORT_ONLY = 'true';
    delete process.env.CSP_POLICY;
    const policy = buildDefaultContentSecurityPolicy('test-nonce');
    const script = policy.split('; ').find(s => s.startsWith('script-src'));
    assert.match(script, /'nonce-test-nonce'/);
    assert.ok(!script.includes('unsafe-inline'));
    assert.ok(!script.includes('unsafe-eval'));
    const response = { headers: new Headers() };
    applyContentSecurityPolicyHeaders(response, 'test-nonce');
    assert.equal(response.headers.get('Content-Security-Policy'), policy);
    assert.equal(response.headers.get('Content-Security-Policy-Report-Only'), null);
    process.env.NODE_ENV = 'development';
    assert.match(buildDefaultContentSecurityPolicy('test-nonce'), /unsafe-eval/);
  } finally {
    for (const name of ['NODE_ENV', 'ENABLE_CSP', 'CSP_REPORT_ONLY', 'CSP_POLICY']) {
      if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    }
  }
});
