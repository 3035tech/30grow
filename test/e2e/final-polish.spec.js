import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding } from './fixtures.js';

let cookies;
test.beforeAll(async ({ playwright, baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  const request = await playwright.request.newContext({ baseURL });
  try {
    expect((await request.post('/api/auth/login', { data: HR })).ok()).toBeTruthy();
    cookies = (await request.storageState()).cookies;
  } finally { await request.dispose(); }
});
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(10000);
  await page.context().addCookies(cookies);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('final polish: English destinations remain readable in both themes and sizes', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [tab, title] of [['team', 'Team'], ['vacancies', 'Jobs'], ['performance-reviews', 'Performance reviews'], ['job-roles', 'Job roles'], ['okr', 'OKRs'], ['pdi', 'IDP'], ['lms', 'Courses']]) {
    await page.goto(`/dashboard?tab=${tab}&lang=en`);
    await dismissManagerOnboarding(page);
    await expect(page.locator('.db-page-title')).toHaveText(title);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    if (tab === 'pdi') await expect(page.locator('.db-sidebar').getByText('IDP', { exact: true })).toHaveCount(1);
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      for (const width of [1365, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `/private/tmp/final-polish-en-${tab}-${dark ? 'dark' : 'light'}-${width}.png`, animations: 'disabled' });
      }
    }
  }
  expect(errors).toEqual([]);
});

test('final polish: employee English home, IDP and courses remain responsive', async ({ page }) => {
  expect((await page.request.post('/api/auth/employee/login', { data: { email: 'colaborador@todos-os-dados.demo', password: HR.password } })).ok()).toBeTruthy();
  const original = await (await page.request.get('/api/employee/me')).json();
  try {
  expect((await page.request.patch('/api/employee/me', { data: { preferredLocale: 'pt-BR' } })).ok()).toBeTruthy();
  await page.goto('/employee/profile');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).click();
  const switched = page.waitForResponse(response => response.url().endsWith('/api/employee/me') && response.request().method() === 'PATCH');
  await page.getByRole('option', { name: /English/ }).click();
  expect((await switched).ok()).toBeTruthy();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');
  for (const [path, title] of [['', /^Hi, /], ['/pdi', 'My development'], ['/lms', 'My courses']]) {
    await page.goto(`/employee${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      for (const width of [1365, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `/private/tmp/final-polish-employee-en-${path.slice(1) || 'home'}-${dark ? 'dark' : 'light'}-${width}.png`, animations: 'disabled' });
      }
    }
  }
  } finally {
    expect((await page.request.patch('/api/employee/me', { data: { preferredLocale: original.person.preferredLocale || 'pt-BR' } })).ok()).toBeTruthy();
  }
});

for (const en of [false, true]) test(`final polish: catalog forms preserve errors and retry (${en ? 'en' : 'pt-BR'})`, async ({ page }) => {
  await page.goto(`/dashboard?tab=performance-reviews&lang=${en ? 'en' : 'pt-BR'}`);
  await dismissManagerOnboarding(page);
  await page.getByRole('tab', { name: en ? 'Competencies' : 'Competências', exact: true }).click();
  for (const category of [false, true]) {
    if (category) await page.getByRole('button', { name: en ? 'Manage categories' : 'Gerenciar categorias', exact: true }).click();
    const endpoint = category ? 'competency-categories' : 'formal-competencies';
    let requests = 0;
    // Presentation-only failure/retry. CRUD persistence has its own real API test.
    await page.route(`**/api/admin/${endpoint}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      requests++;
      if (category && requests === 1) return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
      await route.fulfill({ status: requests === 1 ? 503 : 200, json: requests === 1 ? { error: en ? 'Could not save. Try again.' : 'Não foi possível salvar. Tente novamente.' } : { ok: true } });
    });
    await page.getByRole('button', { name: category ? (en ? 'New category' : 'Nova categoria') : (en ? 'New competency' : 'Nova competência'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    const name = dialog.getByLabel(category ? (en ? 'Category name' : 'Nome da categoria') : (en ? 'Name' : 'Nome'), { exact: true });
    await name.fill('Polish — do not persist');
    const save = dialog.getByRole('button', { name: en ? 'Save' : 'Salvar', exact: true });
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText(en ? 'Could not save' : 'Não foi possível salvar');
    await expect(name).toHaveValue('Polish — do not persist');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(requests).toBe(2);
    await page.unroute(`**/api/admin/${endpoint}`);
  }
});
