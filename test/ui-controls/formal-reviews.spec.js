const { test, expect } = require('@playwright/test');

const review = { id: 1, cycleTitle: 'Avaliação do trimestre', model: '90' };
const detail = { ...review, items: [], raters: [], scores: [] };

for (const failure of ['http', 'network', 'json', 'shape']) {
  test(`formal review list rejects ${failure} failure and retry recovers`, async ({ page }) => {
    let failed = true;
    await page.route('**/api/employee/formal-reviews', route => {
      if (!failed) return route.fulfill({ json: { reviews: [] } });
      if (failure === 'network') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 503, json: {} });
      if (failure === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
      return route.fulfill({ json: {} });
    });
    await page.goto('/employee#formalReviews');
    const section = page.locator('#formalReviews');
    await expect(section.getByRole('button', { name: /tentar de novo/i })).toBeVisible();
    await expect(section).not.toContainText('Nenhuma avaliação formal enviada ainda.');
    failed = false;
    await section.getByRole('button', { name: /tentar de novo/i }).click();
    await expect(section).toContainText('Nenhuma avaliação formal enviada ainda.');
  });

  test(`formal review detail handles ${failure} failure and retry opens result`, async ({ page }) => {
    let failed = true;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/employee/formal-reviews*', route => {
      if (!new URL(route.request().url()).searchParams.has('id')) {
        return route.fulfill({ json: { reviews: [review] } });
      }
      if (!failed) return route.fulfill({ json: { review: detail } });
      if (failure === 'network') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 403, json: {} });
      if (failure === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
      return route.fulfill({ json: { review: { id: 1 } } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/employee#formalReviews');
    const section = page.locator('#formalReviews');
    await section.getByRole('button', { name: /ver resultado/i }).click();
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section.getByRole('button', { name: /ver resultado/i })).toBeEnabled();
    if (failure === 'network') {
      await page.screenshot({ path: test.info().outputPath('formal-review-retry-mobile.png'), fullPage: true });
    }
    failed = false;
    await section.getByRole('button', { name: /tentar de novo/i }).click();
    await expect(section.getByRole('heading', { name: review.cycleTitle })).toBeVisible();
    await expect(section.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
