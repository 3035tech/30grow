import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function fixture() {
  const timers = new Set();
  const warnings = [];
  let client;
  class Redis extends EventEmitter {
    status = 'wait';
    count = 0;
    connects = 0;
    pings = 0;
    constructor(url, options) { super(); this.options = options; client = this; }
    connect() {
      this.connects++;
      this.status = 'connecting';
      return new Promise(resolve => this.once('ready', resolve));
    }
    ready() { this.status = 'ready'; this.emit('ready'); }
    async eval() {
      if (this.fail) throw new Error('Command timed out');
      if (this.status !== 'ready') {
        if (!this.options.enableOfflineQueue) throw new Error('Stream is not writeable');
        await new Promise(resolve => this.once('ready', resolve));
      }
      return ++this.count;
    }
    async pttl() { return 60000; }
    async ping() { this.pings++; if (this.failPing) throw new Error('Command timed out'); return 'PONG'; }
    disconnect(reconnect) { this.reconnect = reconnect; this.status = 'close'; this.emit('close'); }
    async quit() { this.status = 'end'; this.emit('end'); }
  }
  const context = vm.createContext({
    process: { env: { REDIS_URL: 'redis://example.invalid' } },
    URL, Date, Map, Number, String,
    setInterval(callback, ms) { const timer = { callback, ms, unref() { this.unreferenced = true; } }; timers.add(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); },
  });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../lib/identity/rate-limit.js', import.meta.url), 'utf8'), { context });
  const deps = { default: Redis, createHash, logger: { info() {}, warn: (...args) => warnings.push(args) }, incrementMetric() {} };
  await mod.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [name, value] of Object.entries(deps)) this.setExport(name, value);
  }, { context }));
  await mod.evaluate();
  mod.namespace.getSharedRedisClient();
  return { api: mod.namespace, client, timers, warnings };
}

test('concurrent first requests wait for Redis and share its rate-limit bucket', async () => {
  const { api, client, warnings } = await fixture();
  const first = api.checkRateLimit('same-account', 1, 60000);
  const second = api.checkRateLimit('same-account', 1, 60000);
  client.ready();
  const results = await Promise.all([first, second]);
  assert.equal(client.connects, 1);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(warnings.some(([message]) => message.includes('falling back')), false);
  assert.equal(client.options.commandTimeout, 3000);
  await api.closeRateLimitRedis();
});

test('heartbeat sends application traffic, replaces timers on ready and stops on close/shutdown', async () => {
  const { api, client, timers } = await fixture();
  client.ready();
  const timer = [...timers][0];
  assert.equal(timer.ms, 30000);
  assert.equal(timer.unreferenced, true);
  await timer.callback();
  assert.equal(client.pings, 1);
  assert.equal(client.count, 0);
  client.ready();
  assert.equal(timers.size, 1);
  client.disconnect(true);
  assert.equal(timers.size, 0);
  client.ready();
  await api.closeRateLimitRedis();
  assert.equal(timers.size, 0);
});

test('failed heartbeat reconnects a stalled socket and releases its timer', async () => {
  const { api, client, timers } = await fixture();
  client.ready();
  client.failPing = true;
  await [...timers][0].callback();
  assert.equal(client.reconnect, true);
  assert.equal(timers.size, 0);
  await api.closeRateLimitRedis();
});

test('Redis command failure retains the memory fallback and its rate limit', async () => {
  const { api, client, warnings } = await fixture();
  client.ready();
  client.fail = true;
  assert.equal((await api.checkRateLimit('fallback', 1, 60000)).ok, true);
  assert.equal((await api.checkRateLimit('fallback', 1, 60000)).ok, false);
  assert.ok(warnings.some(([message]) => message.includes('falling back')));
  await api.closeRateLimitRedis();
});
