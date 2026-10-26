/** Focused SQL + actual signup service + HTTP + browser proof, DTOV only. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { dtovEnv, assertDtovTarget } from './harness.js';
import { dismissManagerOnboarding } from '../e2e/fixtures.js';

const base = 'http://127.0.0.1:3010';
const env = dtovEnv({ JWT_SECRET: 'dtov-smoke-jwt-secret-min-32-chars-long', COOKIE_SECURE: 'false',
  PORT: '3010', HOSTNAME: '127.0.0.1', NEXT_PUBLIC_APP_URL: base, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-polish-build' });
assertDtovTarget(env);
Object.assign(process.env, env);
const { createSelfServiceSignupIdentity, SELF_SERVICE_COMPANY_ACTION } = await import('../../lib/identity/self-service-signup.js');
const { pool } = await import('../../lib/db.js');
const db = new pg.Client({ host: env.POSTGRES_HOST, port: Number(env.POSTGRES_PORT), database: env.POSTGRES_DB, user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, ssl: false });
let server, browser, page;
let checks = 0;
const stamp = Date.now();
const request = (path, cookie = '', options = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000),
  ...options, headers: { cookie, 'content-type': 'application/json', ...options.headers } });
async function login(path, email) {
  const response = await request(path, '', { method: 'POST', body: JSON.stringify({ email, password: 'DemoTodosDados!2026', locale: 'pt-BR' }) });
  assert.equal(response.status, 200, `login ${path}`); checks++;
  return response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
async function profile(cookie, suffix = '') {
  const response = await request('/api/me' + suffix, cookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/); checks++;
  return response.json();
}
async function license(companyId) {
  return (await db.query('SELECT * FROM company_licenses WHERE company_id=$1', [companyId])).rows[0];
}
async function browserContext(cookie, width = 1365) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addCookies(cookie.split('; ').map((entry) => { const i = entry.indexOf('='); return { name: entry.slice(0, i), value: entry.slice(i + 1), url: base }; }));
  return context;
}
try {
  await db.connect();
  const { rows: [manager] } = await db.query("SELECT id,company_id FROM users WHERE email='direction@todos-os-dados.demo'");
  const companyId = manager.company_id;
  // Restore only the disposable baseline so focused test reruns are independent.
  await db.query("UPDATE company_licenses SET starts_at=now(),expires_at=now()+interval '1 year' WHERE company_id=$1", [companyId]);
  const signup = (extra) => createSelfServiceSignupIdentity({ companyAction: SELF_SERVICE_COMPANY_ACTION.CREATE,
    companyName: 'License test', companySlug: `license-${stamp}`, email: `license-${stamp}@dtov.invalid`, passwordHash: 'unusable-test-only', signupMetadata: {}, ...extra });
  const created = await signup({});
  const initial = await license(created.companyId);
  assert.ok(initial, 'real signup atomically issues license before activation');
  const registered = (await db.query('SELECT created_at,active,signup_pending FROM users WHERE id=$1', [created.userId])).rows[0];
  assert.equal(initial.starts_at.toISOString(), registered.created_at.toISOString());
  assert.equal(registered.active, false); assert.equal(registered.signup_pending, true); checks++;
  await Promise.all([1, 2].map((n) => signup({ companyAction: SELF_SERVICE_COMPANY_ACTION.JOIN, companyId: created.companyId, email: `license-join-${n}-${stamp}@dtov.invalid` })));
  assert.deepEqual(await license(created.companyId), initial, 'new managers cannot reset the term'); checks++;

  const { rows: [fresh] } = await db.query("INSERT INTO companies(name,slug) VALUES('Concurrent license', $1) RETURNING id", [`license-concurrent-${stamp}`]);
  await Promise.all([1, 2].map((n) => signup({ companyAction: SELF_SERVICE_COMPANY_ACTION.JOIN, companyId: fresh.id, email: `license-concurrent-${n}-${stamp}@dtov.invalid` })));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM company_licenses WHERE company_id=$1', [fresh.id])).rows[0].n, 1); checks++;

  await db.query('BEGIN');
  const { rows: [rolled] } = await db.query("INSERT INTO companies(name,slug) VALUES('Rolled back', $1) RETURNING id", [`license-rollback-${stamp}`]);
  await db.query("INSERT INTO users(company_id,email,password_hash,role,signup_source) VALUES($1,$2,'test','direction','early_access')", [rolled.id, `license-rollback-${stamp}@dtov.invalid`]);
  assert.ok(await license(rolled.id));
  await db.query('ROLLBACK');
  assert.equal(await license(rolled.id), undefined, 'rolled-back signup leaves no license'); checks++;

  // Simulate a pre-migration cohort in the disposable database only.
  const { rows: [legacy] } = await db.query("INSERT INTO companies(name,slug) VALUES('Legacy early', $1) RETURNING id", [`license-legacy-${stamp}`]);
  await db.query('BEGIN');
  await db.query('ALTER TABLE users DISABLE TRIGGER users_issue_early_access_license');
  await db.query(`INSERT INTO users(company_id,email,password_hash,role,signup_source,created_at,deleted)
    VALUES($1,$2,'test','direction','early_access','2024-02-29T12:00:00Z',TRUE),
          ($1,$3,'test','hr','early_access','2024-03-03T12:00:00Z',FALSE)`,
  [legacy.id, `legacy-first-${stamp}@dtov.invalid`, `legacy-second-${stamp}@dtov.invalid`]);
  await db.query('ALTER TABLE users ENABLE TRIGGER users_issue_early_access_license');
  await db.query('COMMIT');
  const migration = await readFile('migrations/122_company_early_access_license.sql', 'utf8');
  await db.query(migration);
  const backfilled = await license(legacy.id);
  assert.equal(backfilled.starts_at.toISOString(), '2024-02-29T12:00:00.000Z');
  assert.equal(backfilled.expires_at.toISOString(), '2025-02-28T12:00:00.000Z'); checks++;
  const before = (await db.query('SELECT * FROM company_licenses ORDER BY company_id')).rows;
  await db.query(migration);
  assert.deepEqual((await db.query('SELECT * FROM company_licenses ORDER BY company_id')).rows, before, 'migration retry preserves every license'); checks++;
  await db.query('UPDATE users SET signup_pending=FALSE,active=TRUE WHERE id=$1', [created.userId]);
  assert.deepEqual(await license(created.companyId), initial, 'activation does not restart license'); checks++;

  const { rows: [foreign] } = await db.query("INSERT INTO companies(name,slug) VALUES('No license', $1) RETURNING id", [`license-none-${stamp}`]);
  const foreignEmail = `license-other-${stamp}@dtov.invalid`;
  await db.query(`INSERT INTO users(company_id,email,password_hash,role,active)
    SELECT $1,$2,password_hash,'hr',TRUE FROM users WHERE email='hr@todos-os-dados.demo'`, [foreign.id, foreignEmail]);
  assert.equal(await license(foreign.id), undefined, 'ordinary invitation is not early access'); checks++;

  server = spawn(process.execPath, ['.next-polish-build/standalone/server.js'], { env, stdio: 'inherit' });
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    try { if ((await request('/login')).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(ready, 'compiled server readiness');
  assert.equal((await request('/api/me')).status, 401); checks++;
  const hrCookie = await login('/api/auth/login', 'hr@todos-os-dados.demo');
  const directionCookie = await login('/api/auth/login', 'direction@todos-os-dados.demo');
  const own = await profile(hrCookie);
  assert.equal(own.license.status, 'active');
  assert.deepEqual((await profile(directionCookie)).license, own.license, 'managers share company license'); checks++;
  assert.deepEqual((await profile(hrCookie, `?companyId=${created.companyId}`)).license, own.license, 'query cannot select another tenant'); checks++;
  const foreignCookie = await login('/api/auth/login', foreignEmail);
  assert.equal((await profile(foreignCookie, `?companyId=${companyId}`)).license, null); checks++;
  assert.equal((await request('/api/me', hrCookie, { method: 'PATCH', body: JSON.stringify({ license: { expiresAt: '2099-01-01' }, companyId: foreign.id }) })).status, 400);
  assert.deepEqual((await profile(hrCookie)).license, own.license, 'profile cannot edit commercial dates'); checks++;

  browser = await chromium.launch({ headless: true });
  const context = await browserContext(hrCookie);
  page = await context.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base + '/dashboard?tab=profile');
  await dismissManagerOnboarding(page);
  const summary = page.getByRole('region', { name: 'Licença da empresa' });
  await expect(summary).toContainText(own.license.number);
  await expect(summary).toContainText('Ativa'); checks++;
  await page.getByRole('tab', { name: /Segurança/ }).click();
  await expect(summary).toBeVisible(); checks++;
  await db.query("UPDATE company_licenses SET starts_at='2024-01-01T00:00:00Z',expires_at='2025-01-01T00:00:00Z' WHERE company_id=$1", [companyId]);
  assert.equal((await profile(hrCookie)).license.status, 'expired');
  assert.equal((await request('/api/admin/org-units', hrCookie)).status, 200, 'manager still accesses modules'); checks++;
  await page.reload();
  await expect(summary).toContainText('Vencida');
  await expect(summary).toContainText('apenas um aviso'); checks++;
  for (const width of [390, 1365]) {
    await page.setViewportSize({ width, height: 900 });
    // A translated offscreen drawer still satisfies Playwright isVisible().
    // Escape closes an open drawer without clicking a hidden duplicate button.
    await page.keyboard.press('Escape');
    await expect(page.locator('.db-overlay-visible')).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
    await page.screenshot({ path: `/private/tmp/team30-license-${width}.png`, fullPage: true, animations: 'disabled' }); checks++;
  }
  await page.route('**/api/me', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Profile test failure' }) }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Profile test failure' })).toBeVisible();
  await expect(summary).toHaveCount(0);
  await page.unroute('**/api/me');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await expect(summary).toBeVisible(); checks++;

  const employeeCookie = await login('/api/auth/employee/login', 'colaborador@todos-os-dados.demo');
  assert.equal((await request('/api/me', employeeCookie)).status, 401);
  assert.equal((await request('/api/employee/me', employeeCookie)).status, 200, 'employee access survives expiry'); checks++;
  const employeeContext = await browserContext(employeeCookie);
  page = await employeeContext.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base + '/employee/profile');
  const logout = page.locator('#employee-sidebar').getByRole('button', { name: 'Sair', exact: true });
  await expect(logout).toBeVisible();
  await page.locator('#employee-sidebar .db-sidebar-collapse-toggle').click();
  await expect(logout).toHaveAttribute('title', 'Sair');
  const logoutBounds = await logout.boundingBox();
  assert.ok(logoutBounds.width >= 44 && logoutBounds.height >= 44, 'collapsed logout retains a 44px target'); checks++;
  await page.locator('#employee-sidebar .db-sidebar-collapse-toggle').click();
  await logout.click();
  await expect(page.getByRole('dialog')).toContainText('Encerrar sessão?');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal((await employeeContext.request.get(base + '/api/employee/me')).status(), 200, 'cancel keeps employee session active');
  assert.match(page.url(), /employee\/profile/); checks++;
  await page.route('**/api/auth/employee/session', (route) => route.request().method() === 'DELETE' ? route.abort() : route.continue());
  await logout.click();
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click();
  await expect(page.getByText('Não foi possível sair. Confira sua conexão e tente novamente.')).toBeVisible();
  assert.match(page.url(), /employee\/profile/); checks++;
  await page.unroute('**/api/auth/employee/session');
  await expect(page.getByText('Não foi possível sair. Confira sua conexão e tente novamente.')).toHaveCount(0, { timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await expect(logout).toBeVisible();
  await page.screenshot({ path: '/private/tmp/team30-license-employee-menu.png', fullPage: true, animations: 'disabled' });
  await logout.click();
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click();
  await page.waitForURL(/employee\/login\?reason=logout/);
  assert.equal((await employeeContext.request.get(base + '/api/employee/me')).status(), 401); checks++;

  const topContext = await browserContext(await login('/api/auth/employee/login', 'colaborador@todos-os-dados.demo'));
  page = await topContext.newPage();
  await page.goto(base + '/employee/profile');
  await page.locator('button[aria-controls="employee-profile-menu"]').click();
  await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click();
  await page.waitForURL(/employee\/login\?reason=logout/);
  assert.equal((await topContext.request.get(base + '/api/employee/me')).status(), 401); checks++;
  console.log(`PASS company license: ${checks} checks (signup, concurrency, SQL, tenant, expiry, browser, logout)`);
} catch (error) {
  if (page) await page.screenshot({ path: '/private/tmp/team30-license-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode == null) { server.kill('SIGTERM'); await once(server, 'exit').catch(() => {}); }
  await db.end();
  await pool.end();
}
