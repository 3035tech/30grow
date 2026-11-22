import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding } from './fixtures.js';

async function openEditorFromDetail(page, vacancy) {
  await page.goto(`/dashboard?tab=vacancies&vacancyDetail=${vacancy.id}`);
  await dismissManagerOnboarding(page);
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
}

test('P0: vacancy editor opens, cancels, recovers from API failure and persists', async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect((await page.request.post('/api/auth/login', { data: HR })).ok()).toBeTruthy();
  const list = await (await page.request.get('/api/admin/vacancies?page=1&pageSize=100')).json();
  const vacancies = ['open', 'closed'].map(status => list.items.find(v => v.status === status));
  expect(vacancies.every(Boolean)).toBeTruthy();
  const editor = page.locator('.app-dialog-overlay').filter({ has: page.getByRole('heading', { name: 'Editar vaga', exact: true }) });
  for (const vacancy of vacancies) {
    const sections = vacancy === vacancies[0]
      ? ['pipeline', 'candidates', 'information', 'distribution', 'settings']
      : ['pipeline'];
    for (const section of sections) {
      await page.goto(`/dashboard?tab=vacancies&vacancyDetail=${vacancy.id}&vacancySection=${section}`);
      await dismissManagerOnboarding(page);
      await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
      await expect(editor).toBeVisible();
      await expect.poll(() => editor.evaluate(e => e.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect(editor.getByRole('button', { name: 'Salvar', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(editor.getByRole('button', { name: 'Fechar', exact: true })).toBeFocused();
      await editor.getByRole('button', { name: 'Vencimento da vaga', exact: true }).click();
      const calendar = page.locator('[role="dialog"]').filter({ has: page.locator('[data-day]') });
      await expect(calendar).toBeVisible();
      await expect.poll(() => calendar.evaluate(e => e.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(calendar).toHaveCount(0);
      await expect(editor).toBeVisible();
      expect(await editor.evaluate(e => getComputedStyle(e).position)).toBe('fixed');
      await expect(editor.getByLabel('Título da vaga', { exact: true })).toHaveValue(vacancy.title);
      await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    }
  }
  const vacancy = vacancies[0];
  await openEditorFromDetail(page, vacancy);
  await editor.getByLabel('Título da vaga', { exact: true }).fill(`${vacancy.title} rascunho`);
  await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const endpoint = `**/api/admin/vacancies/${vacancy.id}`;
  await page.goto(`/dashboard?tab=vacancies&vacancyDetail=${vacancy.id}`);
  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  await expect(editor.getByLabel('Título da vaga', { exact: true })).toHaveValue(vacancy.title);
  await page.route(endpoint, async route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada P0' }) }) : route.continue());
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor.getByRole('alert')).toHaveText('Falha simulada P0');
  await expect(editor.getByRole('button', { name: 'Salvar', exact: true })).toBeEnabled();
  await page.unroute(endpoint);
  try {
    await editor.getByLabel('Título da vaga', { exact: true }).fill(`${vacancy.title} P0`);
    await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
    await expect(editor.getByLabel('Título da vaga', { exact: true })).toHaveValue(`${vacancy.title} P0`);
    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
  } finally {
    expect((await page.request.patch(`/api/admin/vacancies/${vacancy.id}`, { data: { title: vacancy.title } })).ok()).toBeTruthy();
  }
  expect(errors).toEqual([]);
});
