import { test, expect } from '@playwright/test';

const header = 'nome_completo,email_corporativo,data_admissao,email_pessoal\n';
const row = { line: 2, fullName: 'Ana Costa', email: 'ana@example.test', personalEmail: '', startDate: '2020-01-01' };

for (const width of [390, 1440]) {
  test(`employee CSV preview and confirmation at ${width}px`, async ({ page }, testInfo) => {
    const calls = [];
    await page.route('**/api/admin/employees/import', async route => {
      const body = route.request().postDataJSON();
      calls.push(body);
      if (body.mode === 'preview') {
        const invalid = body.csv.includes('sem-corporativo');
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          ok: true, preview: { rows: [{ ...row, errors: invalid ? ['email_corporativo'] : [] }],
            total: 1, invalid: invalid ? 1 : 0, canImport: !invalid,
            capacity: { active: 0, limit: 20, exceeded: false } },
        }) });
      } else {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          ok: true, total: 1, rows: [{ line: 2, candidateId: 1, status: 'created' }],
        }) });
      }
    });
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/employee-csv-import');
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar colaboradores atuais' });
    await expect(dialog.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
    await dialog.getByLabel('Arquivo CSV').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from(`${header}Ana,sem-corporativo,2020-01-01,\n`) });
    await expect(dialog.getByText('Informe um e-mail corporativo válido')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
    await dialog.getByLabel('Arquivo CSV').setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from(`${header}Ana Costa,ana@example.test,2020-01-01,\n`) });
    await expect(dialog.getByRole('button', { name: 'Confirmar importação' })).toBeEnabled();
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('employee-csv-preview-mobile.png'), animations: 'disabled' });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Confirmar importação' }).click();
    await expect(dialog.getByRole('status')).toContainText('Registros incluídos: 1');
    await expect(page.getByTestId('imported')).toBeVisible();
    expect(calls.map(call => call.mode)).toEqual(['preview', 'preview', 'import']);
    expect(calls.at(-1).csv).toContain('ana@example.test');
  });
}
