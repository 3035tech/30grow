const { test, expect } = require('@playwright/test');
test('management tables preserve PDI navigation, search, pagination, reminders and expansion', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let reminded = false;
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === '/api/admin/pdi') {
      const rows = [
        {candidateId: 1, candidateName: 'Ana Silva', planId: 2, planTitle: 'Desenvolver liderança', periodEnd: '2026-09-01', periodOverdue: true, overdueItemCount: 1, doneCount: 2, itemCount: 4, donePct: 50},
        {candidateId: 2, candidateName: 'Bruno Costa', planId: null},
      ];
      body = {rows: url.searchParams.get('q') ? rows.slice(0, 1) : rows, total: 25, summary: {activePlanCount: 1}};
    } else if (url.pathname.endsWith('/remind')) reminded = true;
    else if (url.pathname.endsWith('/invites')) body = {invites: [{id: 1, candidateName: 'Carla Souza', candidateEmail: 'carla@example.test', status: 'sent', reminderCount: reminded ? 1 : 0}]};
    else if (url.pathname === '/api/admin/whistleblowing') body = {channels: [{id: 1, title: 'Canal de ética', dueDays: 10, active: true, publicPath: '/ouvidoria/test'}], reports: []};
    else if (url.pathname === '/api/admin/pipeline-stages') body = {stages: []};
    await route.fulfill({json: body});
  });
  await page.goto('/lists');
  const pdi = page.getByRole('region', {name: 'PDI da equipe', exact: true}).filter({has: page.getByRole('table')});
  await expect(pdi.getByRole('columnheader')).toHaveText(['Pessoa', 'Plano', 'Prazo', 'Situação', 'Progresso', 'Ações']);
  await expect(pdi.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await pdi.getByRole('button', {name: 'Abrir PDI'}).click();
  await expect(page.getByTestId('navigation')).toContainText('"candidate":"1"');
  await pdi.getByRole('button', {name: 'Criar PDI'}).click();
  await expect(page.getByTestId('navigation')).toContainText('"candidate":"2"');
  const search = page.getByRole('searchbox', {name: 'Nome do colaborador…'});
  await search.fill('Ana');
  const searched = page.waitForRequest(r => r.url().includes('/api/admin/pdi?') && new URL(r.url()).searchParams.get('q') === 'Ana');
  await search.press('Enter'); await searched;
  await expect(pdi.getByRole('rowheader')).toHaveText(['Ana Silva']);
  const paged = page.waitForRequest(r => r.url().includes('/api/admin/pdi?') && new URL(r.url()).searchParams.get('page') === '2');
  await page.getByRole('button', {name: 'Ir para página 2', exact: true}).click();
  await paged;
  const invites = page.getByTestId('invites');
  await invites.getByRole('button', {name: /lembrete/i}).click();
  await expect.poll(() => reminded).toBe(true);
  await expect(invites.getByRole('table')).toContainText('Carla Souza');
  const templates = page.getByTestId('templates');
  const preview = templates.locator('button[aria-expanded]');
  await preview.click(); await expect(preview).toHaveAttribute('aria-expanded', 'true');
  await preview.click(); await expect(preview).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', {name: /Canais públicos/}).click();
  await expect(page.getByRole('region', {name: 'Canais públicos', exact: true}).getByRole('table')).toContainText('Canal de ética');
  for (const width of [1440, 375]) {
    await page.setViewportSize({width, height: 900});
    await expect(pdi).toBeVisible();
    await page.screenshot({path: test.info().outputPath(`lists-${width}.png`), fullPage: true});
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      outside: [...document.querySelectorAll('main > *, [data-testid], table')].map(el => ({
        tag: el.tagName, fixture: el.closest('[data-testid]')?.dataset.testid || '',
        width: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right),
      })).filter(el => el.right > innerWidth),
      uncontained: [...document.querySelectorAll('body *')].filter(el => {
        if (el.getBoundingClientRect().right <= innerWidth + 1) return false;
        for (let parent=el.parentElement; parent && parent!==document.body; parent=parent.parentElement) {
          if (['auto','scroll','hidden','clip'].includes(getComputedStyle(parent).overflowX)) return false;
        }
        return true;
      }).slice(0,12).map(el=>({tag:el.tagName,class:el.className,fixture:el.closest('[data-testid]')?.dataset.testid || '',right:Math.round(el.getBoundingClientRect().right)})),
    }));
    await test.info().attach(`layout-${width}`, {body: JSON.stringify(layout,null,2),contentType:'application/json'});
    expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});
