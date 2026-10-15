import assert from 'node:assert/strict';
import { profilePdf as pdf } from '../fixtures/profile-pdf.js';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';
import { dismissManagerOnboarding } from '../e2e/fixtures.js';
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);
const { query, pool } = await import('../../lib/db.js');
const base = 'http://127.0.0.1:3010';
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'hr@todos-os-dados.demo',
    password: 'DemoTodosDados!2026',
    locale: 'pt-BR',
  }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((s) => s.split(';')[0])
  .join('; ');
const request = (path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: { cookie, 'Content-Type': 'application/json', ...options.headers },
  });
const companyId = Number(
  (await query("SELECT company_id FROM users WHERE email='hr@todos-os-dados.demo'")).rows[0]
    .company_id,
);
const candidateId = Number(
  (
    await query(
      "INSERT INTO candidates(company_id,full_name,email,city) VALUES($1,'UX Import Fixture',$2,'Porto Alegre') RETURNING id",
      [companyId, `before-${Date.now()}@dtov.invalid`],
    )
  ).rows[0].id,
);
const vacancyId = Number(
  (await query('SELECT id FROM vacancies WHERE company_id=$1 ORDER BY id LIMIT 1', [companyId]))
    .rows[0].id,
);
await query(
  "INSERT INTO vacancy_candidates(company_id,vacancy_id,candidate_id,pipeline_stage) VALUES($1,$2,$3,'new')",
  [companyId, vacancyId, candidateId],
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
await context.addCookies(
  cookie.split('; ').map((entry) => {
    const i = entry.indexOf('=');
    return { name: entry.slice(0, i), value: entry.slice(i + 1), url: base };
  }),
);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dir = '/private/tmp/team30-profile-ux-qa';
await mkdir(dir, { recursive: true });
let checks = 0;
let adminUserId;

try {
  assert.equal(
    (await fetch(`${base}/api/admin/candidates/${candidateId}/cv/import`, { method: 'POST' }))
      .status,
    401,
  );
  checks++;
  await page.goto(`${base}/dashboard?tab=team&candidate=${candidateId}&section=profile`);
  await page.waitForLoadState('networkidle');
  await dismissManagerOnboarding(page);
  console.log('Profile fixture opened');
  const cv = page.getByLabel('Selecionar PDF do currículo');
  await cv.setInputFiles({
    name: 'linkedin-export.pdf',
    mimeType: 'application/pdf',
    buffer: pdf([
      'UX Import Fixture',
      'new-profile@dtov.invalid',
      'Experience: Software engineer, 2020-2026',
      'Skills: JavaScript, React, PostgreSQL',
      'Education: Computer Science',
      'Languages: Portuguese and English',
    ]),
  });
  await expect(page.getByRole('button', { name: 'Ler perfil com IA', exact: true })).toBeVisible({
    timeout: 15000,
  });
  checks++;
  await page.getByRole('button', { name: 'Ler perfil com IA', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Revisar importação de perfil', exact: true });
  await expect(review).toBeVisible({ timeout: 15000 });
  await expect(review.getByRole('checkbox', { name: 'E-mail', exact: true })).not.toBeChecked();
  await expect(
    review.getByRole('checkbox', { name: 'Resumo profissional', exact: true }),
  ).toBeChecked();
  checks++;
  await review.getByRole('checkbox', { name: 'E-mail', exact: true }).check();
  await review
    .getByRole('textbox', { name: 'Resumo profissional', exact: true })
    .fill('Resumo revisado pelo RH: engenharia de software, React e PostgreSQL.');
  await page.screenshot({ path: `${dir}/import-review-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/import-review-mobile.png`, fullPage: true });
  assert.ok(
    await review.evaluate((node) => node.getBoundingClientRect().width <= window.innerWidth),
  );
  checks++;
  await review.getByRole('button', { name: 'Aplicar campos selecionados' }).click();
  await expect(review).toBeHidden();
  await expect(
    page.getByText('Resumo revisado pelo RH: engenharia de software, React e PostgreSQL.', {
      exact: true,
    }),
  ).toBeVisible();
  checks++;
  const row = (
    await query('SELECT email,city,professional_summary FROM candidates WHERE id=$1', [candidateId])
  ).rows[0];
  assert.equal(row.email, 'new-profile@dtov.invalid');
  assert.equal(row.city, 'Porto Alegre');
  assert.ok(row.professional_summary.includes('Resumo revisado'));
  checks++;
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto(
    `${base}/dashboard?tab=talent-bank&list.talent.q=${encodeURIComponent(JSON.stringify('UX Import Fixture'))}`,
  );
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('searchbox').last()).toHaveValue('UX Import Fixture');
  await page.getByRole('button', { name: 'Abrir na Equipe', exact: true }).click();
  await expect(page).toHaveURL(/returnTab=talent-bank/);
  checks++;
  await page
    .getByRole('button', { name: /Voltar/ })
    .first()
    .click();
  await expect(page).toHaveURL(/tab=talent-bank/);
  await expect(page.getByRole('searchbox').last()).toHaveValue('UX Import Fixture');
  checks++;
  for (const tab of [
    'compensation',
    'dp',
    'job-roles',
    'performance-reviews',
    'pdi',
    'succession',
    'exit-analysis',
    'learning-resources',
    'lms',
    'company-benefits',
    'company-feed',
    'motivators',
    'climate',
    'whistleblowing',
    'organization',
    'users',
    'audit',
    'help',
  ]) {
    await page.goto(`${base}/dashboard?tab=${tab}`);
    await page.waitForLoadState('networkidle');
    for (const width of [1365, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
        `${tab} overflow at ${width}`,
      );
    }
    console.log(`UX smoke ${tab}: desktop/mobile OK`);
    checks++;
  }
  const adminEmail = `ux-admin-${Date.now()}@dtov.invalid`;
  adminUserId = Number(
    (
      await query(
        "INSERT INTO users(email,password_hash,role,display_name) SELECT $1,password_hash,'admin','UX Admin Fixture' FROM users WHERE email='hr@todos-os-dados.demo' RETURNING id",
        [adminEmail],
      )
    ).rows[0].id,
  );
  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: 'DemoTodosDados!2026', locale: 'pt-BR' }),
  });
  assert.equal(adminLogin.status, 200);
  const adminContext = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  await adminContext.addCookies(
    adminLogin.headers.getSetCookie().map((entry) => {
      const pair = entry.split(';')[0],
        i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  const adminPage = await adminContext.newPage();
  adminPage.setDefaultTimeout(10000);
  adminPage.on('pageerror', (error) => errors.push(error.message));
  for (const tab of ['companies', 'users', 'leads', 'product-feedback', 'audit']) {
    await adminPage.goto(`${base}/dashboard?tab=${tab}&company=${companyId}`);
    await adminPage.waitForLoadState('networkidle');
    await dismissManagerOnboarding(adminPage);
    for (const width of [1365, 390]) {
      await adminPage.setViewportSize({ width, height: 900 });
      assert.ok(
        await adminPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        `admin ${tab} overflow at ${width}`,
      );
    }
    console.log(`UX admin smoke ${tab}: desktop/mobile OK`);
    checks++;
  }
  await adminPage.screenshot({ path: `${dir}/admin-audit-mobile.png`, fullPage: true });
  await adminContext.close();
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  publicPage.on('pageerror', (error) => errors.push(error.message));
  for (const path of ['/', '/login', '/signup', '/pricing', '/employee/login']) {
    for (const width of [1365, 390]) {
      await publicPage.setViewportSize({ width, height: 900 });
      const response = await publicPage.goto(base + path);
      assert.ok(response.status() < 400);
      await publicPage.waitForLoadState('networkidle');
      assert.ok(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        `${path} overflow at ${width}`,
      );
    }
    console.log(`UX public smoke ${path}: desktop/mobile OK`);
    checks++;
  }
  await publicContext.close();
  await page.goto(`${base}/dashboard?tab=talent-bank`);
  await page.waitForLoadState('networkidle');
  const table = page.getByRole('region', { name: /Tabela de dados/ }).first();
  if (await table.count()) {
    await table.focus();
    await page.keyboard.press('End');
    assert.ok(await table.evaluate((node) => node.scrollLeft > 0));
    checks++;
  }
  await page.screenshot({ path: `${dir}/talent-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Ativar modo escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  checks++;
  await page.screenshot({ path: `${dir}/talent-mobile-dark.png`, fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  checks++;
  console.log(`Profile import and UX browser: ${checks} checks passed`);
} finally {
  await context.close();
  await browser.close();
  if (adminUserId) await query('DELETE FROM users WHERE id=$1', [adminUserId]);
  await query('DELETE FROM candidates WHERE id=$1', [candidateId]);
  await pool.end();
}
