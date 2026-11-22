import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding } from './fixtures.js';

test('RH 3.10: employee registration retains recruitment fields and separate rich RH notes', async ({ page, baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  page.setDefaultTimeout(15000);
  const json = async promise => { const response = await promise; expect(response.ok(), `HTTP ${response.status()}`).toBeTruthy(); return response.json(); };
  await json(page.request.post('/api/auth/login', { data: HR }));
  const { items } = await json(page.request.get('/api/admin/employees/search'));
  const id = items[0].id;
  const endpoint = `/api/admin/candidates/${id}`;
  const before = await json(page.request.get(endpoint));
  const dpBefore = await json(page.request.get(`${endpoint}/dp`));
  const keys = ['linkedinUrl', 'city', 'state', 'salaryExpectation', 'availability', 'source', 'hrNotes'];
  const restore = Object.fromEntries(keys.map(key => [key, before.candidate[key] ?? null]));
  const seed = { linkedinUrl: 'https://www.linkedin.com/in/rh-cadastro', city: 'Porto Alegre', state: 'RS', salaryExpectation: '1234.56', availability: 'immediate', source: 'referral', hrNotes: '<p><strong>Nota RH preservada</strong></p>' };
  try {
    await json(page.request.patch(endpoint, { data: seed }));
    // Old deep link must still lead to the consolidated registration area.
    await page.goto(`/dashboard?tab=team&candidate=${id}&section=profile`);
    await dismissManagerOnboarding(page);
    const section = page.getByRole('region', { name: 'Dados de recrutamento', exact: true });
    await expect(section.getByRole('link', { name: seed.linkedinUrl })).toHaveAttribute('href', seed.linkedinUrl);
    await expect(section.locator('strong')).toHaveText('Nota RH preservada');
    await expect(section).toContainText('Porto Alegre / RS');
    await expect(section).toContainText('1.234,56');
    const edit = section.getByRole('button', { name: 'Editar dados de recrutamento', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Editar dados de recrutamento' });
    await expect(dialog.getByLabel('Cidade', { exact: true })).toHaveValue(seed.city);
    await dialog.getByLabel('Cidade', { exact: true }).fill('Cancelar');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Descartar alterações?', exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await json(page.request.get(endpoint))).candidate.city).toBe(seed.city);
    await edit.click();
    await dialog.getByLabel('Cidade', { exact: true }).fill('Canoas');
    await dialog.getByLabel('LinkedIn', { exact: true }).fill('https://www.linkedin.com/in/rh-atualizado');
    await dialog.getByLabel('Pretensão salarial', { exact: true }).fill('234567');
    await dialog.getByRole('combobox', { name: 'Disponibilidade', exact: true }).click();
    await page.getByRole('option', { name: 'Até 30 dias', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Fonte', exact: true }).click();
    await page.getByRole('option', { name: 'Agência', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Notas de RH', exact: true }).fill('Nota RH atualizada');
    await page.route(`**${endpoint}`, route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: 'Falha temporária do cadastro' } }) : route.continue());
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Falha temporária');
    await expect(dialog.getByLabel('Cidade', { exact: true })).toHaveValue('Canoas');
    await page.unroute(`**${endpoint}`);
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(section).toContainText('Canoas');
    const saved = await json(page.request.get(endpoint));
    expect(saved.candidate.salaryExpectation).toBe('2345.67');
    expect(saved.candidate.hrNotes).toContain('Nota RH atualizada');
    expect(saved.candidate.availability).toBe('30_days');
    expect(saved.candidate.source).toBe('agency');
    expect(saved.candidate.state).toBe(seed.state);
    expect((await json(page.request.get(`${endpoint}/dp`))).profile).toEqual(dpBefore.profile);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(section).toContainText('Canoas');
    await expect(section).toContainText('Nota RH atualizada');
    await section.scrollIntoViewIfNeeded();
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: '/private/tmp/p1-registration-mobile.png', animations: 'disabled' });
    // Clearing fields must persist too, without touching DP notes.
    await edit.click();
    await dialog.getByLabel('LinkedIn', { exact: true }).fill('');
    await dialog.getByRole('textbox', { name: 'Notas de RH', exact: true }).fill('');
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const cleared = await json(page.request.get(endpoint));
    expect(cleared.candidate.linkedinUrl).toBeNull();
    expect(cleared.candidate.hrNotes).toBeNull();
    expect((await json(page.request.get(`${endpoint}/dp`))).profile.internalNotes).toBe(dpBefore.profile.internalNotes);
    await page.route(`**${endpoint}?*`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.candidate.employmentStatus = 'alumni';
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    await expect(section).toBeVisible();
    await expect(edit).toHaveCount(0);
  } finally {
    await page.unroute(`**${endpoint}`);
    await page.unroute(`**${endpoint}?*`);
    await json(page.request.patch(endpoint, { data: restore }));
  }
});
