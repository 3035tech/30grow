import { test, expect } from '@playwright/test';
import { HR, dismissManagerOnboarding } from './fixtures.js';

let adminCookies;
let employeeCookies;
test.beforeAll(async ({ playwright, baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  for (const employee of [false, true]) {
    const request = await playwright.request.newContext({ baseURL });
    try {
      const response = await request.post(employee ? '/api/auth/employee/login' : '/api/auth/login', {
        data: employee ? { email: 'colaborador@todos-os-dados.demo', password: HR.password } : HR,
      });
      expect(response.ok(), `Login: HTTP ${response.status()}, Retry-After ${response.headers()['retry-after'] || 'none'}`).toBeTruthy();
      const { cookies } = await request.storageState();
      if (employee) employeeCookies = cookies;
      else adminCookies = cookies;
    } finally { await request.dispose(); }
  }
});

test.beforeEach(async ({ page, baseURL }) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function noPageOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function captureThemes(page, name, target) {
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    for (const width of [1365, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      if (target) await target.scrollIntoViewIfNeeded();
      else {
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      }
      await noPageOverflow(page);
      await page.screenshot({ path: `/private/tmp/p3-final-${name}-${dark ? 'dark' : 'light'}-${width}.png`, animations: 'disabled' });
      // Snapshot the live set atomically: async loading can enable/disable buttons
      // between calls, making a previously collected nth() locator point elsewhere.
      const contrasts = await textContrasts(page.locator('button.bg-action:enabled'));
      if (new URL(page.url()).pathname === '/dashboard') expect(contrasts.length).toBeGreaterThan(0);
      for (const contrast of contrasts) expect(contrast, `Primary CTA contrast: ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  }
}

async function textContrast(locator) {
  return (await textContrasts(locator))[0];
}

async function textContrasts(locator) {
  return locator.evaluateAll(elements => elements.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => {
    const rgba = value => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (fg, bg) => fg.slice(0, 3).map((value, i) => value * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    const bg = ancestors.reduce((color, node) => blend(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255]);
    const fg = blend(rgba(getComputedStyle(element).color), bg);
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const values = [luminance(bg), luminance(fg)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }));
}

test('P3: admin modules share readable page titles on desktop and mobile', async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().addCookies(adminCookies);
  for (const tab of ['team', 'vacancies', 'performance-reviews', 'job-roles', 'okr', 'pdi', 'lms']) {
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(`/dashboard?tab=${tab}`);
    await dismissManagerOnboarding(page);
    const title = page.locator('.db-page-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('font-size', '24px');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(title).toHaveCSS('text-transform', 'none');
    await expect(page.getByRole('navigation', { name: 'Você está em', exact: true })).toHaveCount(1);
    await noPageOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(title).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({ path: `/private/tmp/p3-${tab}-mobile.png` });
    await captureThemes(page, tab);
  }
  await page.goto('/dashboard?tab=performance-reviews');
  await page.getByRole('tab', { name: 'Competências', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Competências', exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.screenshot({ path: '/private/tmp/p3-competencies-mobile.png' });
  await captureThemes(page, 'competencies');
});

test('P3: dialog labels and controls remain readable and protect unsaved changes', async ({ page }) => {
  await page.context().addCookies(adminCookies);
  await page.goto('/dashboard?tab=okr');
  await dismissManagerOnboarding(page);
  await page.getByRole('button', { name: 'Novo ciclo', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const title = dialog.getByRole('textbox').first();
  await title.fill('Teste visual P3 — não salvar');
  await expect(title).toHaveCSS('font-size', '14px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(title).toHaveCSS('font-size', '16px');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/p3-dialog-mobile.png' });
  await title.focus();
  await page.keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Descartar alterações?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('P3: employee sections, empty state and course navigation work in both themes', async ({ page }) => {
  await page.context().addCookies(employeeCookies);
  // Deliberately empty only the arrival presentation; no database writes.
  await page.route('**/api/employee/home?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.journey = null;
    await route.fulfill({ response, json: body });
  });
  await page.goto('/employee');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
  await expect(page.getByText('Acompanhe suas pendências e próximos passos.')).toBeVisible();
  const arrival = page.locator('#journey');
  const toggle = arrival.getByRole('button').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const empty = arrival.getByText('Seu plano de chegada aparecerá aqui quando o RH o disponibilizar.');
  await expect(empty).toBeVisible();
  await expect(empty).toHaveCSS('font-size', '13px');
  await expect(empty).toHaveCSS('text-align', 'left');
  const surveysToggle = page.locator('#surveys').getByRole('button').first();
  await surveysToggle.click();
  await expect(surveysToggle).toHaveAttribute('aria-expanded', 'true');
  // Detail sections open in their own view without the Today task list.
  await page.goto('/employee/pdi');
  await expect(page.getByRole('heading', { name: 'Meu desenvolvimento', exact: true })).toBeVisible();
  await expect(page.locator('#tasks')).toBeHidden();
  await noPageOverflow(page);
  await page.goto('/employee#oneOnOne');
  await expect(page.locator('#oneOnOne')).toBeVisible();
  await expect(page.locator('#tasks')).toBeHidden();
  await noPageOverflow(page);
  await page.goto('/employee');
  await expect(page.locator('#tasks')).toBeVisible();
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
    expect(await textContrast(empty)).toBeGreaterThanOrEqual(4.5);
    for (const chip of await page.locator('#tasks span.rounded-full').all()) {
      if (await chip.isVisible()) expect(await textContrast(chip)).toBeGreaterThanOrEqual(4.5);
    }
    await page.setViewportSize({ width: 1365, height: 900 });
    await arrival.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/p3-employee-${dark ? 'dark' : 'light'}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await noPageOverflow(page);
    await page.screenshot({ path: `/private/tmp/p3-employee-${dark ? 'dark' : 'light'}-mobile.png` });
  }
  // Sections are reached from the sidebar (no duplicate chip row on Today).
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.getByRole('link', { name: 'Meus cursos' }).first().click();
  await expect(page).toHaveURL(/\/employee\/lms/);
  await expect(page.getByRole('heading', { name: 'Meus cursos', exact: true })).toBeVisible();
  await page.goto('/employee/pdi');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', '24px');
  await noPageOverflow(page);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('P3: populated employee modules and management details keep their layout', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.context().addCookies(employeeCookies);
  await page.goto('/employee');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const id of ['journey', 'surveys', 'pdi', 'oneOnOne']) {
    // Detail sections are standalone views; PDI also has a dedicated route.
    if (id === 'pdi') {
      await page.goto('/employee/pdi');
      const heading = page.getByRole('heading', { name: 'Meu desenvolvimento', exact: true });
      await expect(heading).toBeVisible();
      await captureThemes(page, `employee-${id}`);
      continue;
    } else if (id === 'oneOnOne') await page.goto('/employee#oneOnOne');
    const section = page.locator(`#${id}`);
    await expect(section).toBeVisible();
    await captureThemes(page, `employee-${id}`, section);
  }
  for (const path of ['pdi', 'lms']) {
    await page.goto(`/employee/${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await captureThemes(page, `employee-${path}-dedicated`);
  }
  await page.context().clearCookies();
  await page.context().addCookies(adminCookies);
  const response = await page.request.get('/api/admin/employees/search');
  expect(response.ok()).toBeTruthy();
  const { items } = await response.json();
  expect(items.length).toBeGreaterThan(0);
  for (const section of ['summary', 'oneOnOne', 'journey']) {
    await page.goto(`/dashboard?tab=team&candidate=${items[0].id}&section=${section}`);
    const sectionName = section === 'summary' ? 'Resumo' : section === 'oneOnOne' ? '1:1' : 'Onboarding e desenvolvimento';
    await expect(page.getByRole('tab', { name: sectionName, exact: true })).toHaveAttribute('aria-selected', 'true');
    await captureThemes(page, `person-${section}`);
  }
  expect(errors).toEqual([]);
});
