import { test, expect } from '@playwright/test';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { HR, dismissManagerOnboarding } from './fixtures.js';

test('categories: CRUD, selector, inactive links, tenant isolation and database FK', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname);
  // Fixed synthetic DTOV target: never use application/production environment variables.
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
  await db.connect();
  let foreignCompany;
  let createdCategoryId;
  let createdCompetencyId;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function json(promise, status = 200) {
    const response = await promise;
    const data = await response.json();
    expect(response.status(), JSON.stringify(data)).toBe(status);
    return data;
  }
  const endpoint = '/api/admin/competency-categories';
  const stamp = Date.now();
  const name = `Categoria P1 ${stamp}`;
  const renamed = `${name} editada`;
  const dialog = page.getByRole('dialog');
  async function openCategories() {
    await page.goto('/dashboard?tab=performance-reviews');
    await dismissManagerOnboarding(page);
    await page.getByRole('tab', { name: 'Competências', exact: true }).click();
    await page.getByRole('button', { name: 'Gerenciar categorias' }).click();
    await expect(page.getByRole('heading', { name: 'Categorias de competências' })).toBeVisible();
  }
  const row = () => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: renamed, exact: true }) });
  try {
    const migration = readFileSync('migrations/129_competency_categories.sql', 'utf8');
    const before = (await db.query('SELECT id, company_id, name, active FROM competency_categories ORDER BY id')).rows;
    await db.query('BEGIN');
    try {
      await db.query(migration); await db.query(migration);
      expect((await db.query('SELECT id, company_id, name, active FROM competency_categories ORDER BY id')).rows).toEqual(before);
    } finally { await db.query('ROLLBACK'); }
    await json(page.request.get(endpoint), 401);
    await json(page.request.post(endpoint, { data: { name: 'Unauthorized' } }), 401);
    await json(page.request.post('/api/auth/login', { data: HR }));
    await openCategories();
    await page.getByRole('button', { name: 'Nova categoria', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nome da categoria' }).fill(`${name} cancelada`);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Descartar alterações?', exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await json(page.request.get(`${endpoint}?q=${stamp}`))).total).toBe(0);
    await page.getByRole('button', { name: 'Nova categoria', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nome da categoria' }).fill(name);
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('rowheader', { name, exact: true })).toBeVisible();
    const category = (await json(page.request.get(`${endpoint}?q=${stamp}`))).items[0];
    createdCategoryId = category.id;
    await json(page.request.post(endpoint, { data: { name: ` ${name.toUpperCase()} ` } }), 409);
    await json(page.request.post(endpoint, { data: { name: '  ' } }), 400);
    await page.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nome da categoria' }).fill(renamed);
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(row()).toBeVisible();
    await page.getByRole('textbox', { name: 'Buscar categorias' }).fill('Sem correspondência P1');
    await expect(page.getByText('Nenhuma categoria encontrada. Cadastre uma categoria ou altere a busca.')).toBeVisible();
    await page.getByRole('textbox', { name: 'Buscar categorias' }).fill(renamed);
    await expect(row()).toBeVisible();
    await openCategories();
    await page.getByRole('textbox', { name: 'Buscar categorias' }).fill(renamed);
    await expect(row()).toBeVisible();
    await page.screenshot({ path: '/private/tmp/competency-categories-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.db-sidebar')).not.toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(row().getByRole('button', { name: 'Editar', exact: true })).toBeVisible();
    await row().getByRole('button', { name: 'Excluir', exact: true }).scrollIntoViewIfNeeded();
    await expect(row().getByRole('button', { name: 'Excluir', exact: true })).toBeInViewport();
    await row().getByRole('button', { name: 'Excluir', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.screenshot({ path: '/private/tmp/competency-categories-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const competencyName = `A competência ${stamp}`;
    await page.getByRole('button', { name: 'Voltar às competências' }).click();
    await page.getByRole('button', { name: 'Nova competência', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nome', exact: true }).fill(competencyName);
    await dialog.getByRole('combobox', { name: 'Categoria (opcional)' }).fill(renamed);
    await dialog.getByRole('option', { name: renamed, exact: true }).click();
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: competencyName }) })).toContainText(renamed);
    const competency = (await json(page.request.get('/api/admin/formal-competencies'))).competencies.find(c => c.name === competencyName);
    createdCompetencyId = competency.id;
    expect(Number(competency.categoryId)).toBe(Number(category.id));
    await openCategories();
    await expect(row().getByRole('button', { name: 'Excluir', exact: true })).toBeDisabled();
    await json(page.request.delete(endpoint, { data: { id: Number(category.id) } }), 409);
    await row().getByRole('button', { name: 'Inativar', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(row().getByRole('button', { name: 'Ativar', exact: true })).toBeVisible();
    expect((await json(page.request.get(`${endpoint}?q=${stamp}`))).items).toHaveLength(0);
    await json(page.request.post('/api/admin/formal-competencies', { data: { name: 'Inactive assignment', categoryId: Number(category.id) } }), 409);
    await json(page.request.patch('/api/admin/formal-competencies', { data: { id: Number(competency.id), description: 'Updated', categoryId: Number(category.id) } }));
    const foreign = await db.query("INSERT INTO companies(name,slug) VALUES('Category isolation',$1) RETURNING id", [`category-isolation-${stamp}`]);
    foreignCompany = foreign.rows[0].id;
    const privateCategory = (await db.query('INSERT INTO competency_categories(company_id,name) VALUES($1,$2) RETURNING id', [foreignCompany, 'Private category'])).rows[0];
    const scoped = await json(page.request.get(`${endpoint}?companyId=${foreignCompany}&includeInactive=true`));
    expect(scoped.items.some(c => c.id === privateCategory.id)).toBe(false);
    await json(page.request.patch(endpoint, { data: { companyId: Number(foreignCompany), id: Number(privateCategory.id), name: 'Forbidden' } }), 404);
    await json(page.request.delete(endpoint, { data: { id: Number(privateCategory.id) } }), 404);
    await json(page.request.patch('/api/admin/formal-competencies', { data: { id: Number(competency.id), categoryId: Number(privateCategory.id) } }), 404);
    await expect(db.query('UPDATE company_competencies SET category_id=$1 WHERE id=$2', [privateCategory.id, competency.id])).rejects.toMatchObject({ code: '23503' });
    await json(page.request.patch('/api/admin/formal-competencies', { data: { id: Number(competency.id), categoryId: null } }));
    await openCategories();
    await row().getByRole('button', { name: 'Ativar', exact: true }).click();
    await dialog.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(row().getByRole('button', { name: 'Inativar', exact: true })).toBeVisible();
    await row().getByRole('button', { name: 'Excluir', exact: true }).click();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(row()).toBeVisible();
    await row().getByRole('button', { name: 'Excluir', exact: true }).click();
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(row()).toHaveCount(0);
    expect((await json(page.request.get(`${endpoint}?q=${stamp}&includeInactive=true`))).items).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    // Remove only this run's fixtures, including after an assertion failure.
    if (createdCompetencyId) await db.query('DELETE FROM company_competencies WHERE id=$1', [createdCompetencyId]);
    if (createdCategoryId) await db.query('DELETE FROM competency_categories WHERE id=$1', [createdCategoryId]);
    if (foreignCompany) await db.query('DELETE FROM companies WHERE id=$1', [foreignCompany]);
    await db.end();
  }
});
