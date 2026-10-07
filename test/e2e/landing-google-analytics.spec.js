const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://www.googletagmanager.com/**', route => route.fulfill({ contentType: 'application/javascript', body: 'window.__googleLoaded = true;' }));
  await page.route('**/api/analytics/landing', route => route.fulfill({ json: { ok: true } }));
});

test('não carrega o Google antes de consentir e lembra a recusa', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('googletagmanager.com')) requests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Recusar métricas' })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Recusar métricas' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cookies', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceitar métricas' })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('aceite envia uma visita sanitizada; retirada e saída desabilitam a tag', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(event.blockedURI));
  });
  await page.goto('/?email=pessoa@example.com&token=privado#teste');
  await page.getByRole('button', { name: 'Aceitar métricas' }).click();
  await expect.poll(() => page.evaluate(() => window.__googleLoaded)).toBe(true);
  expect(await page.locator('#google-landing-analytics').evaluate(script => script.nonce)).not.toBe('');
  expect(await page.evaluate(() => window.__cspViolations.filter(uri => uri.includes('google')))).toEqual([]);
  const events = await page.evaluate(() => window.dataLayer.map(item => Array.from(item)));
  const views = events.filter(item => item[0] === 'event' && item[1] === 'page_view');
  expect(views).toHaveLength(1);
  expect(views[0][2].page_location).toMatch(/\/$/);
  expect(JSON.stringify(events)).not.toContain('pessoa@example.com');
  expect(JSON.stringify(events)).not.toContain('privado');
  await page.getByRole('button', { name: 'Cookies', exact: true }).click();
  await page.getByRole('button', { name: 'Recusar métricas' }).click();
  expect(await page.evaluate(() => window['ga-disable-G-3NCBE66VM9'])).toBe(true);
  await page.getByRole('button', { name: 'Cookies', exact: true }).click();
  await page.getByRole('button', { name: 'Aceitar métricas' }).click();
  await page.locator('a[href="/pricing"]').first().click();
  await expect(page).toHaveURL(/\/pricing/);
  expect(await page.evaluate(() => window['ga-disable-G-3NCBE66VM9'])).toBe(true);
  expect(await page.evaluate(() => window.dataLayer.some(item => item[1] === 'landing_cta_click' && item[2].cta_target === 'pricing'))).toBe(true);
});

test('banner cabe no celular sem rolagem horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Sua privacidade' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/30grow-analytics-mobile.png' });
});
