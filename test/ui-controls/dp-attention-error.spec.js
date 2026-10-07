const { test, expect } = require('@playwright/test');

for (const failure of ['http', 'malformed']) {
  test(`DP pending does not show an empty inbox on ${failure} failure; retry recovers`, async ({ page }) => {
    let failed = true;
    await page.route('**/api/admin/dp/attention*', route => {
      if (failed) return route.fulfill({ status: failure === 'http' ? 503 : 200, json: {} });
      return route.fulfill({ json: { requestedLeaves: 2, pendingDocsPeople: 0, absenteeismPeople: 0, pendingTimeRequests: 0, pendingFieldExpenses: 0, pendingDocs: [], leaves: [], absenteeism: [] } });
    });
    await page.goto('/dashboard?persona=owner&company=1&tab=dp');
    await expect(page.getByRole('button', { name: 'Tentar de novo', exact: true })).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: 'Tentar de novo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tentar de novo', exact: true })).toHaveCount(0);
    await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`dp-attention-${failure}.png`), fullPage: true, animations: 'disabled' });
  });
}
