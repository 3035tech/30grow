/**
 * Harness Postgres + Redis efêmeros para /dev-test-validate (DTOV).
 *
 * Segurança: só localhost:55432 / DB enneagram_dtov / user dtov.
 * Redis: localhost:56379 (senha dtov_redis).
 * Nunca usa o .env de produção/dev sem override explícito destas vars.
 *
 * Uso:
 *   node test/dtov/harness.js reset   # down -v → up → migrate → seed
 *   node test/dtov/harness.js up
 *   node test/dtov/harness.js migrate
 *   node test/dtov/harness.js seed [--only=id1,id2]
 *   node test/dtov/harness.js smoke
 *   node test/dtov/harness.js down    # remove volume
 *   node test/dtov/harness.js env     # imprime exports
 *   node test/dtov/harness.js status
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const Redis = require('ioredis');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const COMPOSE_FILE = path.join(__dirname, 'docker-compose.dtov.yml');
const CATALOG_PATH = path.join(__dirname, 'fixtures', 'catalog.json');

export const DTOV_DEFAULTS = Object.freeze({
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '55432',
  POSTGRES_DB: 'enneagram_dtov',
  POSTGRES_USER: 'dtov',
  POSTGRES_PASSWORD: 'dtov_local_only',
  POSTGRES_SSL: 'false',
  POSTGRES_READ_HOST: '',
  REDIS_URL: 'redis://:dtov_redis@127.0.0.1:56379/0',
  REDIS_KEY_PREFIX: 'team30_dtov',
  DTOV: '1',
});

function log(msg) {
  process.stdout.write(`[dtov] ${msg}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`[dtov] ERROR: ${msg}\n`);
  process.exitCode = code;
  throw new Error(msg);
}

/** Bloqueia apontar o harness para banco que não seja o DTOV. */
export function assertDtovTarget(env = process.env) {
  const host = String(env.POSTGRES_HOST || '').trim();
  const port = String(env.POSTGRES_PORT || '').trim();
  const db = String(env.POSTGRES_DB || '').trim();
  const user = String(env.POSTGRES_USER || '').trim();
  const okHost = host === '127.0.0.1' || host === 'localhost';
  if (!okHost) fail(`POSTGRES_HOST must be localhost/127.0.0.1 (got ${host || '(empty)'})`);
  if (port !== DTOV_DEFAULTS.POSTGRES_PORT) {
    fail(`POSTGRES_PORT must be ${DTOV_DEFAULTS.POSTGRES_PORT} (got ${port || '(empty)'})`);
  }
  if (db !== DTOV_DEFAULTS.POSTGRES_DB) {
    fail(`POSTGRES_DB must be ${DTOV_DEFAULTS.POSTGRES_DB} (got ${db || '(empty)'})`);
  }
  if (user !== DTOV_DEFAULTS.POSTGRES_USER) {
    fail(`POSTGRES_USER must be ${DTOV_DEFAULTS.POSTGRES_USER} (got ${user || '(empty)'})`);
  }
  if (String(env.DTOV || '') !== '1') fail('DTOV=1 required');
}

export function dtovEnv(extra = {}) {
  return {
    // Invite/password flows fail with APP_URL_MISSING without a base URL.
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3010',
    ...process.env,
    ...DTOV_DEFAULTS,
    // next start loads .env (real SMTP_HOST/MAIL_FROM); DTOV must never send real mail.
    SMTP_MOCK: '1',
    ...extra,
    DTOV: '1',
    POSTGRES_SSL: 'false',
    POSTGRES_READ_HOST: '',
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: opts.env || process.env,
      stdio: opts.stdio || 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function compose(args, env) {
  await run('docker', ['compose', '-f', COMPOSE_FILE, ...args], { env });
}

async function waitHealthy(env, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const client = new Client({
        host: env.POSTGRES_HOST,
        port: parseInt(env.POSTGRES_PORT, 10),
        database: env.POSTGRES_DB,
        user: env.POSTGRES_USER,
        password: env.POSTGRES_PASSWORD,
        ssl: false,
        connectionTimeoutMillis: 2000,
      });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 800));
    }
    if (Date.now() - start >= timeoutMs) {
      fail('Postgres DTOV did not become ready in time (is Docker running?)');
    }
  }

  const redisUrl = String(env.REDIS_URL || '').trim();
  if (!redisUrl) return;
  const redisStart = Date.now();
  while (Date.now() - redisStart < timeoutMs) {
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      await redis.quit();
      if (pong === 'PONG') return;
    } catch {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  fail('Redis DTOV did not become ready in time (is Docker running?)');
}

async function loadCatalog() {
  const raw = await readFile(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(raw);
  if (!Array.isArray(catalog.fixtures)) fail('catalog.json missing fixtures[]');
  return catalog;
}

async function cmdUp() {
  const env = dtovEnv();
  assertDtovTarget(env);
  log('starting postgres + redis containers…');
  try {
    await compose(['up', '-d'], env);
  } catch (e) {
    fail(`docker compose failed — install/start Docker. ${e.message}`, 2);
  }
  await waitHealthy(env);
  log('postgres + redis ready');
}

async function cmdDown() {
  const env = dtovEnv();
  log('stopping and removing volume…');
  try {
    await compose(['down', '-v', '--remove-orphans'], env);
  } catch (e) {
    fail(`docker compose down failed: ${e.message}`, 2);
  }
  log('down ok');
}

async function cmdBootstrap() {
  const env = dtovEnv();
  assertDtovTarget(env);
  const client = new Client({
    host: env.POSTGRES_HOST,
    port: parseInt(env.POSTGRES_PORT, 10),
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    ssl: false,
  });
  await client.connect();
  try {
    const exists = await client.query(`SELECT to_regclass('public.companies') AS t`);
    if (exists.rows[0]?.t) {
      log('bootstrap skipped (schema already present)');
      return;
    }
    const sqlPath = path.join(ROOT, 'scripts', 'rds-bootstrap-completo.sql');
    log('applying rds-bootstrap-completo.sql (base schema)…');
    const sql = await readFile(sqlPath, 'utf8');
    await client.query(sql);
    log('bootstrap ok');
  } finally {
    await client.end();
  }
}

async function cmdMigrate() {
  const env = dtovEnv();
  assertDtovTarget(env);
  await cmdBootstrap();
  log('migrating…');
  await run('node', [path.join(ROOT, 'scripts', 'migrate.js')], { env });
  log('migrate ok');
}

async function cmdSeed(onlyIds) {
  const env = dtovEnv();
  assertDtovTarget(env);
  const catalog = await loadCatalog();
  let fixtures = catalog.fixtures.filter((f) => f.enabled !== false);
  if (onlyIds?.length) {
    const set = new Set(onlyIds);
    fixtures = fixtures.filter((f) => set.has(f.id));
    if (!fixtures.length) fail(`no fixtures matched --only=${onlyIds.join(',')}`);
  }

  // Topological-ish: respect dependsOn
  const done = new Set();
  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  const queue = [...fixtures];
  let guard = 0;
  while (queue.length && guard < 100) {
    guard += 1;
    const next = queue.find((f) => (f.dependsOn || []).every((d) => done.has(d) || !byId[d]));
    if (!next) fail(`fixture dependency cycle or missing dep: ${queue.map((f) => f.id).join(', ')}`);
    queue.splice(queue.indexOf(next), 1);
    const modPath = path.join(__dirname, 'fixtures', next.module);
    log(`seed ${next.id} (${next.module})…`);
    const mod = await import(pathToFileURL(modPath).href);
    if (typeof mod.seed !== 'function') fail(`${next.module} must export async function seed(client, ctx)`);
    const client = new Client({
      host: env.POSTGRES_HOST,
      port: parseInt(env.POSTGRES_PORT, 10),
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: false,
    });
    await client.connect();
    try {
      await mod.seed(client, { env, fixture: next, catalog });
    } finally {
      await client.end();
    }
    done.add(next.id);
    log(`seed ${next.id} ok`);
  }
}

async function cmdSmoke() {
  const env = dtovEnv();
  assertDtovTarget(env);
  const catalog = await loadCatalog();
  const client = new Client({
    host: env.POSTGRES_HOST,
    port: parseInt(env.POSTGRES_PORT, 10),
    database: env.POSTGRES_DB,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    ssl: false,
  });
  await client.connect();
  try {
    for (const f of catalog.fixtures.filter((x) => x.enabled !== false)) {
      const checks = f.smoke || [];
      for (const c of checks) {
        const r = await client.query(c.sql);
        const n = r.rowCount ?? r.rows?.length ?? 0;
        const min = c.minRows ?? 1;
        if (n < min) {
          fail(`smoke ${f.id}/${c.name || 'check'}: expected >= ${min} rows, got ${n}`);
        }
        log(`smoke ${f.id}/${c.name || 'check'}: ${n} row(s)`);
      }
    }
  } finally {
    await client.end();
  }
  log('smoke ok');
}

async function cmdReset(onlyIds) {
  await cmdDown();
  await cmdUp();
  await cmdMigrate();
  await cmdSeed(onlyIds);
  await cmdSmoke();
  log('reset complete — DB ready for Test agent');
  printEnv();
}

function printEnv() {
  for (const [k, v] of Object.entries(DTOV_DEFAULTS)) {
    process.stdout.write(`export ${k}=${JSON.stringify(v)}\n`);
  }
}

async function cmdStatus() {
  const env = dtovEnv();
  try {
    assertDtovTarget(env);
    const client = new Client({
      host: env.POSTGRES_HOST,
      port: parseInt(env.POSTGRES_PORT, 10),
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: false,
      connectionTimeoutMillis: 1500,
    });
    await client.connect();
    const mig = await client.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`).catch(() => ({
      rows: [{ n: 0 }],
    }));
    const cos = await client.query(`SELECT COUNT(*)::int AS n FROM companies WHERE deleted = FALSE`).catch(() => ({
      rows: [{ n: 0 }],
    }));
    await client.end();
    log(`up · migrations=${mig.rows[0].n} · companies=${cos.rows[0].n}`);
  } catch {
    log('down or unreachable');
    process.exitCode = 1;
  }
}

function parseOnly(argv) {
  const raw = argv.find((a) => a.startsWith('--only='));
  if (!raw) return null;
  return raw
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  const only = parseOnly(argv);

  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    process.stdout.write(`Usage: node test/dtov/harness.js <reset|up|down|bootstrap|migrate|seed|smoke|env|status> [--only=id]\n`);
    return;
  }
  if (cmd === 'up') return cmdUp();
  if (cmd === 'down') return cmdDown();
  if (cmd === 'bootstrap') return cmdBootstrap();
  if (cmd === 'migrate') return cmdMigrate();
  if (cmd === 'seed') return cmdSeed(only);
  if (cmd === 'smoke') return cmdSmoke();
  if (cmd === 'reset') return cmdReset(only);
  if (cmd === 'env') return printEnv();
  if (cmd === 'status') return cmdStatus();
  fail(`unknown command: ${cmd}`);
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((e) => {
    if (!process.exitCode) process.exitCode = 1;
    if (e?.message && !String(e.message).startsWith('POSTGRES_')) {
      process.stderr.write(`[dtov] ${e.message}\n`);
    }
  });
}
