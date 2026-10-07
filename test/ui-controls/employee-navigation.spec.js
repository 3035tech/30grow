const { test, expect } = require('@playwright/test');

async function selected(page, hash) {
  await expect(page).toHaveURL(new RegExp(`/employee#${hash}$`));
  await expect(page.locator(`#employee-sidebar a[href="/employee#${hash}"]`)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#employee-sidebar [aria-current="page"]')).toHaveCount(1);
}

test('rapid section clicks keep the last URL, menu and visible detail', async ({ page }) => {
  await page.goto('/employee');
  const ids = ['feed', 'formalReviews', 'okr', 'feedback', 'company', 'kudos'];
  for (let round = 0; round < 3; round++) {
    for (const id of ids) await page.locator(`#employee-sidebar a[href="/employee#${id}"]`).click();
  }
  await selected(page, 'kudos');
  await expect(page.locator('#kudos')).toBeVisible();
  await expect(page.locator('#employee-detail-title')).toBeFocused();
  // Observe beyond the previous 280ms callback window.
  await page.waitForTimeout(500);
  await selected(page, 'kudos');
  await expect(page.locator('#employee-detail-title')).toBeFocused();
});

test('back and forward keep section URL, menu and content synchronized', async ({ page }) => {
  await page.goto('/employee#formalReviews');
  await selected(page, 'formalReviews');
  await page.locator('#employee-sidebar a[href="/employee#okr"]').click();
  await selected(page, 'okr');
  await page.locator('#employee-sidebar a[href="/employee#company"]').click();
  await selected(page, 'company');
  await page.goBack();
  await selected(page, 'okr');
  await expect(page.locator('#okr')).toBeVisible();
  await page.goBack();
  await selected(page, 'formalReviews');
  await expect(page.locator('#formalReviews')).toBeVisible();
  await page.goForward();
  await selected(page, 'okr');
});

test('pending home load and dedicated pages cannot replay the previous section', async ({ page }) => {
  await page.route('**/api/employee/home*', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto('/employee');
  await page.locator('#employee-sidebar a[href="/employee#feed"]').click();
  await selected(page, 'feed');
  await page.locator('#employee-sidebar a[href="/employee/dp"]').click();
  await expect(page.getByRole('heading', { name: 'Documentos e dados', exact: true })).toBeVisible();
  await page.locator('#employee-sidebar a[href="/employee#formalReviews"]').click();
  await selected(page, 'formalReviews');
  await expect(page.locator('#formalReviews')).toBeVisible();
  await page.locator('#employee-sidebar a[href="/employee/lms"]').click();
  await expect(page).toHaveURL(/\/employee\/lms$/);
  await page.getByRole('link', { name: /Voltar ao início/ }).click();
  await expect(page).toHaveURL(/\/employee$/);
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa de teste', exact: true })).toBeVisible();
  await expect(page.locator('#employee-sidebar a[href="/employee#tasks"]')).toHaveAttribute('aria-current', 'page');
});

test('repeated selection does not duplicate history and an unknown hash resets to Today', async ({ page }) => {
  await page.goto('/employee#formalReviews');
  await selected(page, 'formalReviews');
  const entries = await page.evaluate(() => history.length);
  const link = page.locator('#employee-sidebar a[href="/employee#formalReviews"]');
  await link.click();
  await link.click();
  await selected(page, 'formalReviews');
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.evaluate(() => { location.hash = 'unknown-section'; });
  await expect(page.locator('#employee-sidebar a[href="/employee#tasks"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa de teste', exact: true })).toBeVisible();
});

test('modified click opens another tab without changing the current selection', async ({ page, context }) => {
  await page.goto('/employee#formalReviews');
  await selected(page, 'formalReviews');
  const popupOpened = context.waitForEvent('page');
  await page.locator('#employee-sidebar a[href="/employee#okr"]').click({ modifiers: ['ControlOrMeta'] });
  const popup = await popupOpened;
  await expect(popup).toHaveURL(/\/employee#okr$/);
  await selected(page, 'formalReviews');
  await popup.close();
});

test('mobile menu closes on selection and keeps focus on the selected detail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/employee/dp');
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page.locator('#employee-sidebar a[href="/employee#formalReviews"]').click();
  await expect(page.locator('#formalReviews')).toBeVisible();
  await expect(page.locator('#employee-sidebar')).toHaveAttribute('inert', '');
  await expect(page.locator('#employee-detail-title')).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('employee-navigation-mobile.png'), fullPage: true, animations: 'disabled' });
});
