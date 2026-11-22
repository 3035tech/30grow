/**
 * B-002 — Drag-and-drop no kanban da vaga (gestor HR logado).
 * Demo: uma pessoa avaliada em uma vaga aberta. Idempotente — move entre estágios
 * sem modal (não hired/rejected), a partir da coluna atual.
 */

import { test, expect } from '@playwright/test';
import { HR, clickSidebarItem, dismissManagerOnboarding, fillLogin, html5DragAndDrop } from './fixtures.js';

/** Coluna do kanban cujo cabeçalho contém o rótulo do estágio. */
function stageColumn(page, stageRe) {
  return page.locator('.kanban-scroll > div > div').filter({
    has: page.locator('span', { hasText: stageRe }),
  }).first();
}

/** Estágios sem modal de extras (reject/hire). Prefer targets distinct from source. */
const SAFE_TARGETS = [
  { re: /Entrevista|Interview/i, id: 'interview' },
  { re: /Triagem|Screening/i, id: 'screening' },
  { re: /Novo|New/i, id: 'new' },
  { re: /Teste concluído|Test completed/i, id: 'test_completed' },
];

test.describe('vacancy kanban drag-and-drop', () => {
  test('HR moves candidate card between pipeline columns', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/login');
    await fillLogin(page, HR);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await dismissManagerOnboarding(page);

    const sidebar = page.locator('#dashboard-sidebar');
    await clickSidebarItem(sidebar, /recrutamento|recruitment/i, /vagas|vacancies/i);
    await expect(page).toHaveURL(/tab=vacancies/);

    const listRes = await page.request.get('/api/admin/vacancies?page=1&pageSize=20');
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const rows = Array.isArray(listBody?.items) ? listBody.items : [];
    const openVacancies = rows.filter(
      (v) =>
        v &&
        String(v.status || '').toLowerCase() === 'open' &&
        /engenheiro|fullstack|plataforma/i.test(String(v.title || ''))
    );
    let openVacancy = null;
    let candidateName = '';
    for (const vacancy of openVacancies) {
      const rankingRes = await page.request.get(`/api/admin/vacancies/${vacancy.id}/ranking?locale=pt-BR`);
      if (!rankingRes.ok()) continue;
      const ranking = (await rankingRes.json()).ranking || [];
      const candidate = ranking.find(row => SAFE_TARGETS.some(stage => stage.id === row.pipelineStage));
      if (!candidate) continue;
      openVacancy = vacancy;
      candidateName = candidate.name;
      break;
    }
    expect(openVacancy?.id).toBeTruthy();
    expect(candidateName).toBeTruthy();

    await page.goto(`/dashboard?tab=vacancies&vacancyDetail=${openVacancy.id}`);
    await expect(page).toHaveURL(/vacancyDetail=/);
    await expect(page.getByText(/pipeline de candidatos|candidate pipeline/i)).toBeVisible({
      timeout: 20_000,
    });

    const card = page
      .locator('.kanban-scroll article[draggable="true"]')
      .filter({ hasText: candidateName })
      .first();
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Coluna atual = ancestral de estágio que contém o card
    let sourceMeta = null;
    for (const s of SAFE_TARGETS) {
      const col = stageColumn(page, s.re);
      if ((await col.locator('article[draggable="true"]').filter({ hasText: candidateName }).count()) > 0) {
        sourceMeta = s;
        break;
      }
    }
    expect(sourceMeta).toBeTruthy();

    const targetMeta = SAFE_TARGETS.find((s) => s.id !== sourceMeta.id);
    expect(targetMeta).toBeTruthy();

    const fromCol = stageColumn(page, sourceMeta.re);
    const toCol = stageColumn(page, targetMeta.re);

    const patchPromise = page.waitForResponse(
      (res) => {
        if (res.request().method() !== 'PATCH') return false;
        const u = res.url();
        return (
          (/\/api\/admin\/assessments\/\d+/.test(u) ||
            /\/api\/admin\/vacancies\/\d+\/candidates\//.test(u)) &&
          res.ok()
        );
      },
      { timeout: 20_000 }
    );

    await html5DragAndDrop(card, toCol);
    await patchPromise;

    await expect(toCol.getByText(candidateName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(fromCol.getByText(candidateName, { exact: true })).toHaveCount(0);
  });
});
