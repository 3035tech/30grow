import { test, expect } from '@playwright/test';
import { profilePdf } from '../fixtures/profile-pdf.js';

test('PDF first creates a candidate only after review and duplicate correction', async ({ page }) => {
  const calls = [];
  await page.route('**/api/admin/vacancies/7/candidates/cv-import', async (route) => {
    const body = route.request().postData() || '';
    const mode = body.includes('name="mode"\r\n\r\ncreate') ? 'create' : 'analyze';
    calls.push({ mode, body });
    if (mode === 'analyze') {
      await route.fulfill({ json: {
        ok: true, token: 'review-token',
        suggestions: { email: 'existing@example.test', professionalSummary: 'Experiência sugerida' },
        duplicate: { id: 42, fullName: 'Pessoa existente' }, warnings: [],
      } });
    } else await route.fulfill({ status: 201, json: { ok: true, candidateId: 99 } });
  });
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/candidate-cv-first');
  await expect(page.getByRole('button', { name: 'Ler arquivo com IA' })).toBeDisabled();
  await page.getByLabel('Escolher arquivo').setInputFiles({
    name: 'curriculo.pdf', mimeType: 'application/pdf',
    buffer: profilePdf(['Pessoa existente', 'existing@example.test', 'Experiencia profissional']),
  });
  await page.getByRole('button', { name: 'Ler arquivo com IA' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revisar novo candidato' });
  await expect(dialog.getByText('Já existe um cadastro para este e-mail', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Criar candidato' })).toBeDisabled();
  await expect(page.getByTestId('candidate-created')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Nome' }).fill('Pessoa revisada');
  await dialog.getByRole('textbox', { name: 'E-mail' }).fill('revisada@example.test');
  await expect(dialog.getByRole('button', { name: 'Criar candidato' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Criar candidato' }).click();
  await expect(page.getByTestId('candidate-created')).toHaveText('Candidato 99');
  expect(calls.map((call) => call.mode)).toEqual(['analyze', 'create']);
  expect(calls[1].body).toContain('revisada@example.test');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
