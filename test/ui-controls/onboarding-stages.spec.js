import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`direct inclusion selects all, clears all and retains individual decisions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/onboarding-stages');
    await page.getByRole('button', { name: 'Incluir colaborador', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await expect(dialog.getByRole('status')).toContainText('4 de 4 etapas selecionadas.');
    await expect(dialog.getByRole('button', { name: 'Marcar todas', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Desmarcar todas', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('O convite de acesso é independente.');
    await expect(dialog.getByRole('button', { name: 'Desmarcar todas', exact: true })).toBeDisabled();
    if (width === 390) await page.screenshot({ path: '/private/tmp/30grow-stage-selection-polish-mobile.png', fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Marcar todas', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
    const d30 = dialog.getByRole('checkbox', { name: 'Acompanhamento de 30 dias', exact: true });
    await d30.uncheck();
    await d30.press('Space');
    await expect(d30).toBeChecked();
    await d30.press('Space');
    await expect(dialog.getByRole('status')).toContainText('3 de 4 etapas selecionadas.');
    await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByTestId('result')).toHaveText(JSON.stringify({ onboardingStages: ['arrival','d60','d90'] }));
  });
  test(`hiring can dispense every onboarding stage at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/onboarding-stages');
    await page.getByRole('button', { name: 'Contratar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirmar contratação', exact: true });
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Desmarcar todas', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('0 de 4 etapas selecionadas.');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByTestId('result')).toContainText('"onboardingStages":[]');
    await expect(dialog).toHaveCount(0);
  });
}
