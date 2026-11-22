import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding } from './fixtures.js';

test('P1: profile errors preserve values, save is single/atomic and cancel is read-only', async ({ page, baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  page.setDefaultTimeout(15000);
  expect((await page.request.post('/api/auth/login', { data: HR })).ok()).toBeTruthy();
  const { items } = await (await page.request.get('/api/admin/employees/search')).json();
  const id = items[0].id;
  const endpoint = `/api/admin/candidates/${id}`;
  const before = await (await page.request.get(`${endpoint}/dp`)).json();
  let patchCount = 0;
  let dpPatchCount = 0;
  page.on('request', request => {
    if (request.method() !== 'PATCH') return;
    if (new URL(request.url()).pathname === endpoint) patchCount++;
    if (new URL(request.url()).pathname === `${endpoint}/dp`) dpPatchCount++;
  });
  try {
    await page.goto(`/dashboard?tab=team&candidate=${id}&section=dp`);
    await dismissManagerOnboarding(page);
    const edit = page.getByRole('button', { name: 'Editar ficha', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Editar ficha' });
    const name = dialog.getByLabel('Nome completo', { exact: true });
    const emergency = dialog.getByLabel('Nome do contato de emergência', { exact: true });
    const save = dialog.getByRole('button', { name: 'Salvar', exact: true });
    await name.fill('Teste Recuperacao Ficha');
    await emergency.fill('Contato Recuperacao');
    await dialog.getByLabel('CPF', { exact: true }).fill('123');
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Informe os 11 dígitos do CPF.');
    await expect(name).toHaveValue('Teste Recuperacao Ficha');
    expect(patchCount).toBe(0);
    await dialog.getByLabel('CPF', { exact: true }).fill(before.profile.cpf || '');
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Falha simulada. Tente novamente.' }) });
    });
    await save.click();
    await expect(dialog.getByRole('alert')).toContainText('Falha simulada');
    await expect(name).toHaveValue('Teste Recuperacao Ficha');
    await expect(emergency).toHaveValue('Contato Recuperacao');
    const unchanged = await (await page.request.get(`${endpoint}/dp`)).json();
    expect(unchanged.candidate.fullName).toBe(before.candidate.fullName);
    expect(unchanged.profile.emergencyName).toBe(before.profile.emergencyName);
    await page.unroute(`**${endpoint}`);
    let pendingSave;
    await page.route(`**${endpoint}`, route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      pendingSave = route;
    });
    await save.click();
    await expect.poll(() => Boolean(pendingSave)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    await expect(name).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await pendingSave.continue();
    await page.unroute(`**${endpoint}`);
    await expect(dialog).toHaveCount(0);
    expect(patchCount).toBe(2);
    expect(dpPatchCount).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await edit.click();
    await expect(name).toHaveValue('Teste Recuperacao Ficha');
    await expect(emergency).toHaveValue('Contato Recuperacao');
    await name.fill('Cancelar sem salvar');
    await dialog.getByRole('combobox', { name: 'Tipo de vínculo', exact: true }).click();
    await page.getByRole('option', { name: before.candidate.workFormat === 'pj' ? 'CLT' : 'PJ', exact: true }).click();
    const effectiveDate = dialog.getByLabel('Data de vigência', { exact: true });
    await expect(effectiveDate).toBeVisible();
    await expect(effectiveDate).toHaveAttribute('aria-required', 'true');
    await save.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(patchCount).toBe(2);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(patchCount).toBe(2);
    const after = await (await page.request.get(`${endpoint}/dp`)).json();
    expect(after.candidate.workFormat).toBe(before.candidate.workFormat);
    expect(after.workFormatHistory).toEqual(before.workFormatHistory);
  } finally {
    await page.unroute(`**${endpoint}`);
    const restored = await page.request.patch(endpoint, { data: { fullName: before.candidate.fullName, dpProfile: { emergencyName: before.profile.emergencyName } } });
    expect(restored.ok()).toBeTruthy();
  }
});
