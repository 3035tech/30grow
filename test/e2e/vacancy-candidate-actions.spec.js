import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { HR, dismissManagerOnboarding, uniqueCandidateEmail, html5DragAndDrop } from './fixtures.js';

test('expired vacancy link sends invites; candidate deletion confirms, recovers and refreshes', async ({ page, baseURL }) => {
  test.skip(!process.env.VACANCY_LINK_TEST_DATABASE_URL, 'Requires an explicitly configured local test database and SMTP mock');
  test.setTimeout(240_000);
  expect(['127.0.0.1', 'localhost']).toContain(new URL(baseURL).hostname);
  expect(process.env.SMTP_MOCK).toBe('1');
  const dbUrl = process.env.VACANCY_LINK_TEST_DATABASE_URL;
  expect(dbUrl).toBeTruthy();
  expect(['127.0.0.1', 'localhost']).toContain(new URL(dbUrl).hostname);
  const db = new Pool({ connectionString: dbUrl });
  let candidateId;
  try {
    expect((await page.request.post('/api/auth/login', { data: HR })).ok()).toBeTruthy();
    const vacancies = await (await page.request.get('/api/admin/vacancies?pageSize=100')).json();
    const vacancy = vacancies.items.find(v => v.status === 'open');
    expect(vacancy).toBeTruthy();
    const name = `Teste Exclusao ${Date.now()}`;
    const created = await page.request.post(`/api/admin/vacancies/${vacancy.id}/candidates`, {
      data: { fullName: name, email: uniqueCandidateEmail('invite-delete') },
    });
    expect(created.ok()).toBeTruthy();
    candidateId = (await created.json()).candidateId;
    const oldLink = await db.query("UPDATE vacancy_links SET expires_at = NOW() - INTERVAL '1 day' WHERE vacancy_id = $1 AND active RETURNING token", [vacancy.id]);
    expect(oldLink.rowCount).toBe(1);
    await page.goto(`/dashboard?tab=vacancies&vacancyDetail=${vacancy.id}&vacancySection=candidates`);
    await dismissManagerOnboarding(page);
    const card = page.locator('div.rounded-xl').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Excluir pessoa e respostas', exact: true }) }).last();
    await expect(card).toBeVisible();
    const inviteResponse = page.waitForResponse(r => r.url().endsWith(`/candidates/${candidateId}/invite`) && r.request().method() === 'POST');
    await card.getByRole('button', { name: 'Enviar eneagrama', exact: true }).click();
    expect((await inviteResponse).ok()).toBeTruthy();
    expect((await db.query('SELECT token FROM vacancy_links WHERE vacancy_id = $1 AND active', [vacancy.id])).rows[0].token).toBe(oldLink.rows[0].token);
    await expect(card.getByText('Eneagrama: Enviado', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Pipeline', exact: true }).click();
    const pipelineCard = page.locator('.kanban-scroll div[draggable="true"]').filter({ hasText: name });
    const approved = page.locator('.kanban-scroll > div > div').filter({
      has: page.locator('.sticky').filter({ hasText: 'Aprovado' }),
    });
    await expect(pipelineCard).toBeVisible();
    await expect(pipelineCard.getByRole('combobox', { name: 'Responsável pelo candidato', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Mover para estágio', exact: true })).toHaveCount(0);
    const stageResponse = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith(`/candidates/${candidateId}`));
    await html5DragAndDrop(pipelineCard, approved);
    expect((await stageResponse).ok()).toBeTruthy();
    await expect(approved).toContainText(name);
    expect((await db.query('SELECT pipeline_stage FROM vacancy_candidates WHERE candidate_id = $1 AND vacancy_id = $2', [candidateId, vacancy.id])).rows[0].pipeline_stage).toBe('approved');
    await page.getByRole('tab', { name: 'Candidatos', exact: true }).click();

    let deletes = 0;
    page.on('request', r => { if (r.method() === 'DELETE') deletes++; });
    await card.getByRole('button', { name: 'Excluir pessoa e respostas', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('todas as respostas/avaliações associadas');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(deletes).toBe(0);
    await expect(card).toBeVisible();

    await page.route(`**/api/admin/candidates/${candidateId}`, route => route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, json: { error: 'Falha simulada ao excluir' } }) : route.continue());
    await card.getByRole('button', { name: 'Excluir pessoa e respostas', exact: true }).click();
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(dialog).toContainText('Falha simulada ao excluir');
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(card).toBeVisible();
    await page.unroute(`**/api/admin/candidates/${candidateId}`);
    await card.getByRole('button', { name: 'Excluir pessoa e respostas', exact: true }).click();
    await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    expect((await db.query('SELECT id FROM candidates WHERE id = $1', [candidateId])).rowCount).toBe(0);
    expect((await db.query('SELECT id FROM candidate_invites WHERE candidate_id = $1', [candidateId])).rowCount).toBe(0);
    candidateId = null;

    // Exercise the second reported path: send immediately after registration.
    await db.query("UPDATE vacancy_links SET expires_at = NOW() - INTERVAL '1 day' WHERE vacancy_id = $1 AND active", [vacancy.id]);
    const createName = `Teste Cadastro ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Nome completo', exact: true }).fill(createName);
    await page.getByRole('textbox', { name: 'email@exemplo.com', exact: true }).fill(uniqueCandidateEmail('invite-on-create'));
    await page.getByRole('checkbox', { name: 'Enviar Eneagrama ao cadastrar', exact: true }).check();
    const registrationResponse = page.waitForResponse(r => r.url().endsWith(`/vacancies/${vacancy.id}/candidates`) && r.request().method() === 'POST');
    const autoInviteResponse = page.waitForResponse(r => /\/candidates\/\d+\/invite$/.test(r.url()) && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Cadastrar candidato', exact: true }).click();
    const registered = await registrationResponse;
    expect(registered.ok()).toBeTruthy();
    candidateId = (await registered.json()).candidateId;
    expect((await autoInviteResponse).ok()).toBeTruthy();
    await expect(page.getByText(createName, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('candidate-actions.png'), fullPage: true });
  } finally {
    if (candidateId) await page.request.delete(`/api/admin/candidates/${candidateId}`);
    await db.end();
  }
});
