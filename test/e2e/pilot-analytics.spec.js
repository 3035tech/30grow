/** Pilot smoke for Reports: UI, metadata, request trace and tenant scope. */
import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding, fillLogin } from './fixtures.js';

test('pilot reports: filters, trace metadata and tenant isolation', async ({ page }) => {
  await page.goto('/login');
  await fillLogin(page, HR);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await dismissManagerOnboarding(page);

  await page.goto('/dashboard?tab=analytics');
  await page.getByRole('button', { name: /Filtrar período|Report filters/i }).click();
  const start = page.getByLabel(/data início|start date/i);
  const end = page.getByLabel(/data fim|end date/i);
  await expect(start).toBeVisible({ timeout: 20_000 });
  await expect(end).toBeVisible();

  const [startBox, endBox] = await Promise.all([start.boundingBox(), end.boundingBox()]);
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  expect(Math.abs(startBox.y - endBox.y)).toBeLessThan(8);

  const chooseDate = async (control, iso) => {
    await control.click();
    const calendar = page.getByRole('dialog', { name: /selecionar data|select date/i });
    const current = await calendar.locator('[data-day][tabindex="0"]').getAttribute('data-day');
    const [year, month] = iso.split('-').map(Number);
    const [currentYear, currentMonth] = current.split('-').map(Number);
    const distance = (year - currentYear) * 12 + month - currentMonth;
    const navigation = calendar.getByRole('button', { name: distance < 0 ? /mês anterior|previous month/i : /próximo mês|next month/i });
    for (let n = 0; n < Math.abs(distance); n++) await navigation.click();
    await calendar.locator('[data-day="' + iso + '"]').click();
  };
  await chooseDate(start, '2025-01-01');
  await chooseDate(end, '2026-12-31');
  await page.getByRole('button', { name: /^aplicar$|^apply$/i }).click();
  await expect(page).toHaveURL(/analyticsStart=2025-01-01/);
  await page.reload();
  await page.getByRole('button', { name: /Filtrar período|Report filters/i }).click();
  await expect(start).toHaveText('01/01/2025');
  await expect(end).toHaveText('31/12/2026');

  const baseline = await page.request.get('/api/admin/analytics/metrics');
  const forged = await page.request.get('/api/admin/analytics/metrics?companyId=99999999');
  expect(baseline.ok()).toBeTruthy();
  expect(forged.ok()).toBeTruthy();
  expect(baseline.headers()['x-request-id']).toBeTruthy();
  const [baselineBody, forgedBody] = await Promise.all([baseline.json(), forged.json()]);
  expect(baselineBody.meta?.generatedAt).toBeTruthy();
  expect(baselineBody.meta?.sampleSize).toBeTruthy();
  expect(forgedBody.metrics).toEqual(baselineBody.metrics);
});
