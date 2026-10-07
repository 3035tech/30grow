const { test, expect } = require('@playwright/test');

for (const companyId of [null, 1]) {
  test(`profile requests company modules only for a tenant (${companyId})`, async ({ page }) => {
    let calls = 0;
    await page.route('**/api/me', route => route.fulfill({ json: { user: { id: 90001, role: companyId ? 'hr' : 'admin', companyId, email: 'gestao@example.test', displayName: 'Gestão de teste' } } }));
    await page.route('**/api/me/company-modules', route => {
      calls++;
      return route.fulfill({ status: companyId ? 200 : 403, json: { enabledModules: null, canEdit: false } });
    });
    await page.goto(`/dashboard?persona=${companyId ? 'owner' : 'admin'}&tab=profile`);
    await expect(page.getByRole('textbox', { name: /e-mail/i }).first()).toHaveValue('gestao@example.test');
    await expect(page.getByRole('button', { name: /salvar/i }).first()).toBeEnabled();
    expect(calls).toBe(companyId ? 1 : 0);
    await page.screenshot({ path: test.info().outputPath(`profile-company-${companyId}.png`), fullPage: true, animations: 'disabled' });
  });
}
