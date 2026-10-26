import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`climate starter choice is clear at ${width}px`, async ({ page }, testInfo) => {
    await page.route('**/api/admin/climate-surveys*', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('benchmark=1')
        ? { surveys: [] }
        : { items: [], minResponses: 5 }),
    }));
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/climate-starter');
    await page.getByRole('button', { name: 'Nova pesquisa' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Criar pesquisa de clima' });
    await expect(dialog.getByText('Perguntas iniciais')).toBeVisible();
    await expect(dialog.getByText('Você pode revisar, editar e excluir as perguntas enquanto a pesquisa estiver em rascunho.')).toBeVisible();
    const starter = dialog.getByRole('combobox', { name: 'Perguntas iniciais' });
    await expect(starter).toHaveText('Incluir 5 afirmações e 2 perguntas abertas');
    await starter.click();
    await expect(page.getByRole('option', { name: 'Começar sem perguntas' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('climate-starter-mobile.png'), animations: 'disabled' });
  });
}
