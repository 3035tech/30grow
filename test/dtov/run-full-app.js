/**
 * Orquestra: DTOV reset (opcional) → Next em :3010 com env DTOV → http-smoke + full-regression.
 *
 *   npm run dtov:full-app
 *   DTOV_SKIP_RESET=1 npm run dtov:full-app   # reusa DB já seedado
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DTOV_DEFAULTS, dtovEnv, assertDtovTarget } from './harness.js';
import { runHttpSmoke } from './http-smoke.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = String(process.env.DTOV_APP_PORT || '3010');
const BASE_URL = `http://127.0.0.1:${PORT}`;

function run(cmd, args, env, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env,
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

async function waitHttp(url, timeoutMs = 120000) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch (e) {
      lastErr = e.message || String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready at ${url}: ${lastErr}`);
}

async function main() {
  const env = {
    ...dtovEnv({
      JWT_SECRET: process.env.JWT_SECRET || 'dtov-smoke-jwt-secret-min-32-chars-long',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      CRON_SECRET: process.env.CRON_SECRET || 'dtov-cron-secret',
      HEALTH_STATUS_TOKEN: process.env.HEALTH_STATUS_TOKEN || 'dtov-health-token',
      COOKIE_SECURE: 'false',
      PORT,
    }),
  };
  assertDtovTarget(env);

  if (process.env.DTOV_SKIP_RESET !== '1') {
    process.stdout.write('[full-app] dtov reset…\n');
    await run('node', [path.join(__dirname, 'harness.js'), 'reset'], env);
  } else {
    process.stdout.write('[full-app] skip reset (DTOV_SKIP_RESET=1)\n');
  }

  process.stdout.write('[full-app] SQL/lib regression…\n');
  await run('node', [path.join(__dirname, 'full-regression.js'), '--dtov'], env);

  process.stdout.write(`[full-app] starting Next on ${BASE_URL}…\n`);
  const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'dev', '-p', PORT, '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bootLog = '';
  child.stdout.on('data', (b) => {
    const s = b.toString();
    bootLog += s;
    if (/Ready|started server/i.test(s)) process.stdout.write(`[next] ${s.trim()}\n`);
  });
  child.stderr.on('data', (b) => {
    bootLog += b.toString();
  });

  const killNext = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.on('exit', killNext);
  process.on('SIGINT', () => {
    killNext();
    process.exit(130);
  });

  try {
    await waitHttp(`${BASE_URL}/login`, 180000);
    process.stdout.write('[full-app] server ready — HTTP smoke…\n');
    // runHttpSmoke executes in this parent process and imports helpers that read
    // process.env (DB/Redis/session cache). Keep it on the same asserted DTOV
    // target as the spawned Next server; never let those helpers fall back to .env.
    Object.assign(process.env, env, { BASE_URL });
    assertDtovTarget(process.env);
    const summary = await runHttpSmoke(BASE_URL);
    if (summary.failed) {
      process.exitCode = 1;
      process.stderr.write(`[full-app] HTTP smoke failed: ${summary.failed} check(s)\n`);
    } else if (process.env.DTOV_SKIP_BROWSER === '1') {
      process.stdout.write('[full-app] skip browser (DTOV_SKIP_BROWSER=1) — HTTP GREEN\n');
    } else {
      process.stdout.write('[full-app] browser smoke (Playwright)…\n');
      try {
        await run(
          path.join(ROOT, 'node_modules', '.bin', 'playwright'),
          ['test'],
          { ...env, BASE_URL, DTOV_RESET_RATE_LIMITS: '1' }
        );
        process.stdout.write('[full-app] ALL GREEN (SQL + HTTP + browser)\n');
      } catch (e) {
        process.exitCode = 1;
        process.stderr.write(`[full-app] browser smoke failed: ${e.message}\n`);
      }
    }
  } catch (e) {
    process.exitCode = 1;
    process.stderr.write(`[full-app] ERROR: ${e.message}\n`);
    if (bootLog) process.stderr.write(bootLog.slice(-4000));
  } finally {
    killNext();
    await new Promise((r) => setTimeout(r, 500));
    if (process.env.DTOV_KEEP !== '1') {
      process.stdout.write('[full-app] dtov down…\n');
      try {
        await run('node', [path.join(__dirname, 'harness.js'), 'down'], env);
      } catch (e) {
        process.stderr.write(`[full-app] down: ${e.message}\n`);
      }
    } else {
      process.stdout.write('[full-app] keeping DTOV (DTOV_KEEP=1)\n');
    }
  }

  process.exit(process.exitCode || 0);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
