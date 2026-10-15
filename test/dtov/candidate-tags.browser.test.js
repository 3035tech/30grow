import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';
import { dismissManagerOnboarding } from '../e2e/fixtures.js';

const env = dtovEnv();
assertDtovTarget(env);
const base = 'http://127.0.0.1:3010';
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'hr@todos-os-dados.demo',
    password: 'DemoTodosDados!2026',
    locale: 'pt-BR',
  }),
});
assert.equal(login.status, 200, await login.text());
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(';')[0])
  .join('; ');
const request = (path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: { cookie, 'Content-Type': 'application/json', ...options.headers },
  });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
await context.addCookies(
  cookie.split('; ').map((entry) => {
    const i = entry.indexOf('=');
    return { name: entry.slice(0, i), value: entry.slice(i + 1), url: base };
  }),
);
const page = await context.newPage();
const errors = [];
const createdTagIds = [];
const originalAssignments = new Map();
const suffix = String(Date.now()).slice(-5);
const names = [`.NET ${suffix}`, `C# ${suffix}`, `Líder técnico ${suffix}`];
const addedFromCandidate = `React ${suffix}`;
const setTagMode = async (mode) => {
  await page.getByRole('combobox', { name: 'Modo do filtro de tags' }).click();
  await page
    .getByRole('option', {
      name: { any: 'Qualquer uma das tags', all: 'Todas as tags', none: 'Sem tags' }[mode],
      exact: true,
    })
    .click();
};
let vacancyId, savedViewId;
let checks = 0;
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('/private/tmp/team30-tags-qa', { recursive: true });
try {
  await page.goto(`${base}/dashboard?tab=talent-bank`);
  await page.waitForLoadState('networkidle');
  await dismissManagerOnboarding(page);
  assert.equal((await fetch(`${base}/api/admin/candidate-tags`)).status, 401);
  assert.equal((await request('/api/admin/talent-bank?tagIds=abc')).status, 400);
  assert.equal((await request('/api/admin/candidate-tags?companyId=999999999')).status, 200);
  checks += 3;
  const meta = await request('/api/admin/talent-bank');
  assert.equal(meta.status, 200);
  const { items, total } = await meta.json();
  const first = items.find((row) => row.stage === 'interview') || items[0];
  const second = items.find((row) => row.stage === 'new') || items[1];
  vacancyId = first.vacancyId;
  originalAssignments.set(
    first.id,
    first.tags.map((tag) => Number(tag.id)),
  );
  originalAssignments.set(
    second.id,
    second.tags.map((tag) => Number(tag.id)),
  );

  await page.getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Gerenciar tags', exact: true });
  await expect(manager).toBeVisible();
  for (const [index, name] of names.entries()) {
    await manager.getByLabel('Nome', { exact: true }).fill(name);
    await manager
      .getByRole('radio', { name: ['Verde', 'Azul', 'Roxo'][index], exact: true })
      .locator('..')
      .click();
    await manager.getByRole('button', { name: 'Criar tag', exact: true }).click();
    await expect(manager.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('');
    await expect(manager.getByRole('textbox', { name: 'Nome', exact: true })).toBeFocused();
    await expect(manager.getByText(name, { exact: true })).toBeVisible();
    const currentCatalog = await (await request('/api/admin/candidate-tags')).json();
    createdTagIds.push(Number(currentCatalog.tags.find((tag) => tag.name === name).id));
    checks++;
  }
  await page.screenshot({ path: '/private/tmp/team30-tags-qa/tag-manager.png', fullPage: true });
  await manager.getByRole('button', { name: 'Fechar', exact: true }).click();
  const catalog = await (await request('/api/admin/candidate-tags')).json();
  const tags = names.map((name) => catalog.tags.find((tag) => tag.name === name));
  assert.ok(tags.every(Boolean));

  await page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }).click();
  const editor = page.getByRole('dialog', { name: `Tags · ${first.fullName}`, exact: true });
  await expect(editor).toBeVisible();
  for (const name of names) await editor.getByLabel(name, { exact: true }).check();
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).toBeHidden();
  const firstRow = page.getByRole('row').filter({ hasText: first.fullName });
  await expect(firstRow.getByRole('button', { name: 'Mostrar todas as tags' })).toBeVisible();
  await firstRow.getByRole('button', { name: 'Mostrar todas as tags' }).click();
  for (const name of names) await expect(firstRow.getByText(name, { exact: true })).toBeVisible();
  checks++;

  await page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled();
  await editor.getByLabel(names[2], { exact: true }).uncheck();
  await editor.getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
  await expect(editor).toBeHidden();
  await manager.getByLabel('Nome', { exact: true }).fill(addedFromCandidate);
  await manager.getByRole('button', { name: 'Criar tag', exact: true }).click();
  await expect(manager.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('');
  await expect(manager.getByText(addedFromCandidate, { exact: true })).toBeVisible();
  const addedCatalog = await (await request('/api/admin/candidate-tags')).json();
  createdTagIds.push(Number(addedCatalog.tags.find((tag) => tag.name === addedFromCandidate).id));
  await manager
    .getByRole('textbox', { name: 'Buscar no cadastro de tags', exact: true })
    .fill(addedFromCandidate);
  await expect(manager.getByRole('button', { name: 'Editar tag', exact: true })).toHaveCount(1);
  await manager.getByRole('textbox', { name: 'Buscar no cadastro de tags', exact: true }).fill('');
  checks++;
  await manager.getByRole('button', { name: 'Voltar à seleção', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel(names[0], { exact: true })).toBeChecked();
  await expect(editor.getByLabel(names[1], { exact: true })).toBeChecked();
  await expect(editor.getByLabel(names[2], { exact: true })).not.toBeChecked();
  await expect(editor.getByLabel(addedFromCandidate, { exact: true })).toBeChecked();
  await page.screenshot({
    path: '/private/tmp/team30-tags-qa/candidate-tag-selection.png',
    fullPage: true,
  });
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(editor).toBeHidden();
  checks++;

  await page.locator('summary').filter({ hasText: 'Tags' }).click();
  await page.getByRole('textbox', { name: 'Buscar tags', exact: true }).fill('no-matching-tag');
  await expect(page.getByText('Nenhuma tag corresponde à busca.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar tags', exact: true }).fill('');
  await page.keyboard.press('Escape');
  await expect(page.locator('summary').filter({ hasText: 'Tags' })).toBeFocused();
  checks++;

  const assignSecond = await request(`/api/admin/candidates/${second.id}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tagIds: [Number(tags[0].id)] }),
  });
  assert.equal(assignSecond.status, 200);
  await page.locator('summary').filter({ hasText: 'Tags' }).click();
  await page.getByLabel(names[0], { exact: true }).check();
  await page.getByLabel(names[1], { exact: true }).check();
  await expect(page.getByText('2 pessoa(s)', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: `Remover filtro ${names[0]}`, exact: true }).click();
  await expect(page.getByText('1 pessoa(s)', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Tags' }).click();
  await page.getByLabel(names[0], { exact: true }).check();
  await expect(page.getByText('2 pessoa(s)', { exact: true })).toBeVisible();
  checks++;
  await setTagMode('all');
  await expect(page.getByText('1 pessoa(s)', { exact: true })).toBeVisible();
  await setTagMode('none');
  await expect(page.getByText(`${total - 2} pessoa(s)`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect(page.getByText(`${total} pessoa(s)`, { exact: true })).toBeVisible();
  checks += 3;

  await page.goto(
    `${base}/dashboard?tab=vacancies&vacancyDetail=${vacancyId}&vacancySection=pipeline`,
  );
  await page.waitForLoadState('networkidle');
  await page.locator('summary').filter({ hasText: 'Tags' }).click();
  await page.getByLabel(names[0], { exact: true }).check();
  await page.getByLabel(names[1], { exact: true }).check();
  await setTagMode('all');
  await expect(
    page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Editar tags · ${second.fullName}`, exact: true }),
  ).toHaveCount(0);
  const tagMenu = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Tags' }) });
  if ((await tagMenu.getAttribute('open')) !== null) await tagMenu.locator('summary').click();
  await expect(tagMenu).not.toHaveAttribute('open', '');
  await page.screenshot({
    path: '/private/tmp/team30-tags-qa/kanban-filtered.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Salvar visão', exact: true }).click();
  await page.getByLabel('Nome da visão', { exact: true }).fill(`Tags QA ${suffix}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar visão', exact: true }).click();
  await expect(page.getByRole('button', { name: `Tags QA ${suffix}`, exact: true })).toBeVisible();
  const workspace = await (
    await request(`/api/admin/recruiting-workspace?vacancyId=${vacancyId}`)
  ).json();
  const view = workspace.views.find((entry) => entry.name === `Tags QA ${suffix}`);
  savedViewId = view.id;
  assert.equal(view.filters.tagMode, 'all');
  assert.deepEqual(
    view.filters.tagIds,
    tags.slice(0, 2).map((tag) => Number(tag.id)),
  );
  await setTagMode('none');
  await expect(
    page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: `Tags QA ${suffix}`, exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Modo do filtro de tags' })).toHaveText(
    'Todas as tags',
  );
  await expect(
    page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }),
  ).toBeVisible();
  checks += 2;

  await page.goto(`${base}/dashboard?tab=team&candidate=${first.id}&section=profile`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: `Editar tags · ${first.fullName}`, exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: `Tags · ${first.fullName}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  checks++;

  await page.goto(`${base}/dashboard?tab=talent-bank`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
  const tagRow = page
    .getByRole('dialog')
    .locator('div')
    .filter({ has: page.getByText(names[0], { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Editar tag', exact: true }) })
    .last();
  await tagRow.getByRole('button', { name: 'Editar tag', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Nome', { exact: true }).fill(`Backend ${suffix}`);
  await page.getByRole('dialog').getByLabel('Ativa', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText(`Backend ${suffix}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: second.fullName })
      .getByText(`Backend ${suffix}`, { exact: true }),
  ).toBeVisible();
  const profile = await (await request(`/api/admin/candidates/${first.id}`)).json();
  assert.ok(
    profile.candidate.tags.some((tag) => tag.name === `Backend ${suffix}` && tag.active === false),
  );
  checks++;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
  await page.screenshot({
    path: '/private/tmp/team30-tags-qa/tag-manager-mobile.png',
    fullPage: true,
  });
  const dialog = page.getByRole('dialog');
  assert.ok(
    await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    'mobile tag manager must fit',
  );
  checks++;
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  const toggle = page.getByRole('button', { name: /Ativar modo escuro|Switch to dark/i });
  if (await toggle.count()) {
    await toggle.click();
    await page.getByRole('button', { name: 'Gerenciar tags', exact: true }).click();
    await page.screenshot({
      path: '/private/tmp/team30-tags-qa/tag-manager-mobile-dark.png',
      fullPage: true,
    });
    checks++;
  }
  console.log(`Candidate tags browser: ${checks} checks passed.`);
  assert.deepEqual(errors, []);
} finally {
  for (const [id, tagIds] of originalAssignments)
    await request(`/api/admin/candidates/${id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    });
  if (savedViewId)
    await request(`/api/admin/recruiting-workspace?vacancyId=${vacancyId}&viewId=${savedViewId}`, {
      method: 'DELETE',
    });
  {
    const { Client } = await import('pg');
    const db = new Client({
      host: env.POSTGRES_HOST,
      port: Number(env.POSTGRES_PORT),
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: false,
    });
    await db.connect();
    try {
      await db.query(
        "DELETE FROM candidate_tags WHERE id=ANY($1::bigint[]) OR (company_id=(SELECT company_id FROM users WHERE email='hr@todos-os-dados.demo' LIMIT 1) AND name=ANY($2::text[]))",
        [createdTagIds, [...names, addedFromCandidate, `Backend ${suffix}`]],
      );
    } finally {
      await db.end();
    }
  }
  await browser.close();
}
