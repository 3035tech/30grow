/**
 * MVP-03: new company → role-default manager → new role/vacancy → assessment → hire.
 * Only the bootstrap administrator is seeded. Business records are created in UI.
 * Run only against DTOV; synthetic records remain for diagnosis until DTOV reset.
 */
import { test, expect as baseExpect } from '@playwright/test';
import { dismissManagerOnboarding, fillLogin, uniqueCandidateEmail, html5DragAndDrop, clickSidebarItem } from './fixtures.js';

// Local Next dev compiles each first-visited route on demand.
const expect = baseExpect.configure({ timeout: 60_000 });

async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function logout(page) {
  // Next dev's issue badge can overlap the sidebar footer at this viewport.
  const devBadge = page.getByRole('button', { name: 'Collapse issues badge', exact: true });
  if (await devBadge.isVisible()) await devBadge.click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar sessão', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'E-mail', exact: true })).toBeVisible();
}
async function login(page, credentials) {
  await page.goto('/login');
  await fillLogin(page, credentials);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}

test('MVP-03 creates a company and manager, recruits and hires the same candidate', async ({ page, context, baseURL }, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(60_000);
  expect(process.env.DTOV, 'This mutating journey requires DTOV=1').toBe('1');
  expect(['127.0.0.1', 'localhost']).toContain(new URL(baseURL).hostname);
  const stamp = `${Date.now()}-${testInfo.retry}`;
  const companyName = `Piloto E2E ${stamp}`;
  const roleName = `Analista Piloto ${stamp}`;
  const candidateName = `Candidato Piloto ${stamp}`;
  const manager = { email: uniqueCandidateEmail('pilot-manager'), password: 'PilotE2E!2026' };
  const candidateEmail = uniqueCandidateEmail('pilot-candidate');
  let companyId, vacancyId;

  await test.step('Create a company and select only the necessary modules', async () => {
    await login(page, { email: process.env.DTOV_ADMIN_EMAIL || 'admin@3035tech.com', password: process.env.DTOV_ADMIN_PASSWORD || 'TroqueEstaSenha123!' });
    await dismissManagerOnboarding(page);
    await clickSidebarItem(page.locator('#dashboard-sidebar'), /^Administração(?: · \d+)?$/, 'Empresas');
    await page.getByRole('button', { name: 'Nova empresa', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Criar', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Nome da empresa', exact: true }).fill(companyName);
    await page.getByRole('button', { name: 'Só núcleo', exact: true }).click();
    await page.getByRole('checkbox', { name: /^Recrutamento Vagas, funil, banco de talentos e links públicos$/ }).check();
    await page.getByRole('checkbox', { name: 'Cargos Papéis, rubrica e faixa de mercado', exact: true }).check();
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/companies');
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    companyId = (await response.json()).id;
    expect(companyId).toBeTruthy();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: companyName })).toBeVisible();
  });

  await test.step('Create an HR manager with empty optional overrides and verify role defaults', async () => {
    await page.getByRole('button', { name: 'Usuários', exact: true }).click();
    await page.getByRole('button', { name: 'Novo usuário', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'E-mail', exact: true }).fill(manager.email);
    await page.getByRole('textbox', { name: 'Senha (deixe vazio = convidar por e-mail)', exact: true }).fill(manager.password);
    await choose(page, 'Company ID (obrigatório para hr/direction)', `${companyName} (#${companyId})`);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/users');
    await page.getByRole('button', { name: 'Criar usuário', exact: true }).click();
    const response = await created;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).not.toHaveProperty('modules');
    await expect(page.getByRole('row').filter({ hasText: manager.email })).toBeVisible();
    await logout(page);
    await login(page, manager);
    await dismissManagerOnboarding(page);
    await clickSidebarItem(page.locator('#dashboard-sidebar'), /^Pessoas(?: · \d+)?$/, 'Equipe');
    await expect(page.locator('#dashboard-sidebar').getByRole('button', { name: 'Equipe', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Administração(?: · \d+)?$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Recrutamento(?: · \d+)?$/ })).toBeVisible();
  });
  let assessmentLink, publicLink;
  const sidebar = page.locator('#dashboard-sidebar');
  await test.step('Create a role and publish its vacancy from empty states', async () => {
    await clickSidebarItem(sidebar, /^Recrutamento(?: · \d+)?$/, 'Cargos');
    await expect(page.getByText('Nenhum cargo cadastrado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Novo cargo', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Criar', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: 'Nome do cargo', exact: true }).fill(roleName);
    await page.getByRole('spinbutton', { name: 'T1 O Perfeccionista — Peso (%)', exact: true }).fill('50');
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: roleName })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Vagas', exact: true }).click();
    await expect(page.getByText('Nenhuma vaga ainda.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Nova vaga', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Criar', exact: true })).toBeDisabled();
    await choose(page, 'Cargo base (opcional) A vaga herda a rubrica T1–T9 do cargo.', roleName);
    await expect(page.getByText('Prévia da rubrica do cargo', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Título da vaga', exact: true }).fill(roleName);
    await page.getByRole('textbox', { name: 'Resumo da vaga, requisitos-chave, modelo de trabalho…', exact: true }).fill('Vaga sintética local para validar candidatura, avaliação e contratação.');
    await page.getByRole('button', { name: 'Página pública Expandir', exact: true }).click();
    await page.getByRole('checkbox', { name: /Página pública da vaga/ }).check();
    await page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Ver candidatos', exact: true }).click();
    await expect(page.getByText('Pipeline de candidatos', { exact: true })).toBeVisible();
    vacancyId = new URL(page.url()).searchParams.get('vacancyDetail');
    expect(vacancyId).toBeTruthy();
    await page.getByRole('tab', { name: 'Divulgação', exact: true }).click();
    assessmentLink = await page.getByRole('link', { name: 'Abrir: Link do candidato', exact: true }).getAttribute('href');
    publicLink = await page.getByRole('link', { name: 'Abrir: Página pública', exact: true }).getAttribute('href');
    expect(new URL(assessmentLink).origin).toBe(new URL(baseURL).origin);
    expect(new URL(publicLink).origin).toBe(new URL(baseURL).origin);
  });

  // A separate, unauthenticated context proves the public path does not use HR cookies.
  const publicContext = await context.browser().newContext({ locale: 'pt-BR' });
  const candidate = await publicContext.newPage();
  try {
    await test.step('Apply publicly and invite the same candidate', async () => {
      await candidate.goto(publicLink);
      await expect(candidate.getByRole('heading', { name: roleName, exact: true })).toBeVisible();
      await candidate.getByRole('button', { name: 'Candidatar-se', exact: true }).click();
      await candidate.getByRole('textbox', { name: 'Nome completo', exact: true }).fill(candidateName);
      await candidate.getByRole('textbox', { name: 'E-mail', exact: true }).fill(candidateEmail);
      await candidate.getByRole('checkbox').check();
      await candidate.getByRole('button', { name: 'Enviar candidatura', exact: true }).click();
      await expect(candidate.getByText('Candidatura registrada. A equipe entrará em contato se precisar de mais etapas.', { exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Candidatos', exact: true })).toBeVisible();
      await page.getByRole('tab', { name: 'Candidatos', exact: true }).click();
      await page.getByRole('button', { name: 'Convidar por e-mail', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Nome do candidato', exact: true }).fill(candidateName);
      await dialog.getByRole('textbox', { name: 'email@exemplo.com', exact: true }).fill(candidateEmail);
      const invitation = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/admin/vacancies/${vacancyId}/invite`);
      await dialog.getByRole('button', { name: 'Enviar Eneagrama', exact: true }).click();
      expect((await invitation).ok()).toBeTruthy();
    });
    await test.step('Complete the public assessment through the generated vacancy link', async () => {
      await candidate.goto(assessmentLink);
      await expect(candidate.getByRole('button', { name: 'Começar →', exact: true })).toBeDisabled();
      await candidate.getByPlaceholder('Ex: Maria Silva', { exact: true }).fill(candidateName);
      await candidate.getByPlaceholder('Ex: maria@empresa.com', { exact: true }).fill(candidateEmail);
      await candidate.getByRole('checkbox').check();
      await candidate.getByRole('button', { name: 'Começar →', exact: true }).click();
      for (let question = 1; question <= 54; question += 1) {
        await expect(candidate.getByText(`Questão ${question} de 54`, { exact: true })).toBeVisible();
        const answer = candidate.getByRole('button', { name: '3 Às vezes', exact: true });
        if (question === 54) {
          const [submitted] = await Promise.all([
            candidate.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/results', { timeout: 90_000 }),
            answer.click(),
          ]);
          expect(submitted.ok()).toBeTruthy();
        } else {
          await answer.click();
        }
      }
      await expect(candidate.getByRole('heading', { name: 'Obrigado!', exact: true })).toBeVisible();
    });
  } finally {
    await publicContext.close();
  }

  await test.step('Review the result, save the decision, approve and hire', async () => {
    await page.reload();
    await expect(page.getByRole('button', { name: 'Teste ok', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expandir', exact: true }).last().click();
    const decision = 'Decisão de teste: aprovado para contratação sintética no ambiente DTOV.';
    await page.getByRole('textbox', { name: 'Anotações da entrevista…', exact: true }).fill(decision);
    const savedNotes = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/vacancies/${vacancyId}/candidates/`));
    await page.getByRole('button', { name: 'Salvar notas', exact: true }).click();
    expect((await savedNotes).ok()).toBeTruthy();
    await page.reload();
    await page.getByRole('button', { name: 'Expandir', exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: 'Anotações da entrevista…', exact: true })).toHaveText(decision);
    await page.getByRole('tab', { name: 'Pipeline', exact: true }).click();
    const card = page.getByTestId('vacancy-candidate-card');
    await expect(card).toHaveCount(1);
    const column = (label) => page.locator('.kanban-scroll > div > div').filter({
      has: page.locator('.sticky').filter({ hasText: label }),
    });
    await expect(page.getByRole('combobox', { name: 'Mover para estágio', exact: true })).toHaveCount(0);
    await expect(column('Teste concluído')).toContainText(candidateName);
    await html5DragAndDrop(card, column('Aprovado'));
    await expect(column('Aprovado')).toContainText(candidateName);
    await html5DragAndDrop(card, column('Contratado'));
    await expect(page.getByRole('dialog', { name: 'Confirmar contratação', exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(column('Aprovado')).toContainText(candidateName);
    await html5DragAndDrop(card, column('Contratado'));
    await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(column('Contratado')).toContainText(candidateName);
    await page.reload();
    await expect(column('Contratado')).toContainText(candidateName);
  });

  await test.step('Find exactly the same hired person in Team after reload', async () => {
    await clickSidebarItem(sidebar, /^Pessoas(?: · \d+)?$/, 'Equipe');
    await expect(page).toHaveURL(/tab=team/);
    const person = page.getByRole('button', { name: `Abrir: ${candidateName}`, exact: true });
    await expect(person).toHaveCount(1);
    await expect(person).toContainText('colaborador');
    await person.click();
    await expect(page.getByText(candidateEmail, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(candidateEmail, { exact: true })).toHaveCount(1);
    await testInfo.attach('hired-person', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
