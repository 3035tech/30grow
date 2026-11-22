import { test, expect } from '@playwright/test';
import pg from 'pg';
import Redis from 'ioredis';
import { HR } from './fixtures.js';

test('P1: shared questionnaires, 90/180/360 roles, relational answers, completed results and explicit PDI', async ({ page, baseURL }) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(15_000);
  expect(['localhost','127.0.0.1']).toContain(new URL(baseURL).hostname);
  const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
  const createdCycles = [], createdPeople = [];
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  let competencyId;
  async function json(promise) { const response = await promise; const data = await response.json(); expect(response.ok(), `${response.status()} ${JSON.stringify(data)}`).toBeTruthy(); return data; }
  await db.connect();
  try {
    // Repeated local runs must not inherit this test's earlier rate-limit counters.
    // Explicit DTOV endpoint/prefix only; never flush Redis or disable application limits.
    const redis = new Redis('redis://:dtov_redis@127.0.0.1:56379/0');
    try {
      const window = Math.floor(Date.now() / 600000);
      await redis.del(...['unknown','127.0.0.1','::1','::ffff:127.0.0.1'].flatMap(ip => ['public-formal-review','public-formal-review-get'].map(key => `team30_dtov:rl:v1:${key}:${ip}:${window}`)));
    } finally { await redis.quit(); }
    await json(page.request.post('/api/auth/login', { data: HR }));
    const { items } = await json(page.request.get('/api/admin/employees/search'));
    const { candidate } = await json(page.request.get(`/api/admin/candidates/${items[0].id}`));
    const companyId = Number(candidate.companyId), stamp = Date.now();
    const manager = (await db.query("INSERT INTO candidates(company_id, full_name, email, employment_status) VALUES($1,$2,$3,'employee') RETURNING id", [companyId, `P1 manager ${stamp}`, `p1.manager.${stamp}@example.test`])).rows[0];
    createdPeople.push(manager.id);
    const subject = (await db.query("INSERT INTO candidates(company_id, full_name, email, employment_status, manager_candidate_id) VALUES($1,$2,$3,'employee',$4) RETURNING id", [companyId, `P1 subject ${stamp}`, `p1.subject.${stamp}@example.test`, manager.id])).rows[0];
    createdPeople.push(subject.id);
    const { competency } = await json(page.request.post('/api/admin/formal-competencies', { data: { name: `P1 relational ${stamp}`, description: 'Compartilha conhecimentos.', selfDescription: 'Compartilho conhecimentos.' } }));
    competencyId = competency.id;
    const today = new Date().toISOString().slice(0, 10), tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    let lastReview;
    for (const [model, includeSelf, expectedRoles] of [['90', false, ['manager']], ['180', true, ['manager','self','upward']], ['360', true, ['manager','self','upward','external']]]) {
      console.log(`Validating ${model} questionnaire`);
      const { cycle } = await json(page.request.post('/api/admin/formal-review-cycles', { data: { title: `P1 ${model} ${stamp}`, model, includeSelf, competencyIds: [Number(competency.id)], periodStart: today, periodEnd: tomorrow, responseScale: 'frequency', openQuestions: ['Qual foi sua contribuição?'], instructions: 'Considere todo o período.' } }));
      createdCycles.push(cycle.id);
      expect(cycle.questionnaire[0].label).toBe(competency.name);
      expect(cycle.openQuestions[0].id).toBeTruthy();
      const { review } = await json(page.request.post(`/api/admin/formal-review-cycles/${cycle.id}/reviews`, { data: { subjectCandidateId: Number(subject.id), ...(model === '360' ? { externalName: 'Cliente P1', externalEmail: 'p1.client@example.test' } : {}) } }));
      const updated = await json(page.request.patch(`/api/admin/formal-review-cycles/${cycle.id}`, { data: { questionnaire: [{ competencyId: Number(competency.id), selfDescription: 'Compartilho conhecimentos com clareza.' }], instructions: 'Instruções revisadas.' } }));
      expect(updated.cycle.openQuestions[0].id).toEqual(cycle.openQuestions[0].id);
      await json(page.request.post(`/api/admin/formal-review-cycles/${cycle.id}/publish`, { data: {} }));
      const opened = await json(page.request.get(`/api/admin/formal-reviews/${review.id}`));
      expect(opened.review.raters.map(r => r.role).sort()).toEqual(expectedRoles.sort());
      expect((await page.request.patch(`/api/admin/formal-review-cycles/${cycle.id}`, { data: { responseScale: 'agreement' } })).ok()).toBe(false);
      for (const rater of opened.review.raters) {
        const endpoint = `/api/public/formal-review/${rater.token}`;
        const form = await json(page.request.get(endpoint));
        expect(form.responseScale).toBe('frequency');
        expect(form.instructions).toBe('Instruções revisadas.');
        expect(form.openQuestions).toEqual(cycle.openQuestions);
        expect(form.subjectName).toBe(rater.role === 'upward' ? `P1 manager ${stamp}` : `P1 subject ${stamp}`);
        expect(form.items[0].selfDescription).toBe('Compartilho conhecimentos com clareza.');
        const body = { scores: form.items.map(item => ({ itemId: Number(item.id), score: rater.role === 'upward' ? 1 : 4 })), openAnswers: [{ questionId: form.openQuestions[0].id, answer: 'Contribuição registrada.' }] };
        const forged = await page.request.post(endpoint, { data: { ...body, openAnswers: [{ questionId: 999999999, answer: 'Forged' }] } });
        expect(forged.ok()).toBe(false);
        await json(page.request.post(endpoint, { data: body }));
        expect((await page.request.post(endpoint, { data: body })).ok()).toBe(false);
      }
      await json(page.request.post(`/api/admin/formal-reviews/${review.id}/finalize`, { data: {} }));
      await json(page.request.patch(`/api/admin/formal-review-cycles/${cycle.id}`, { data: { status: 'closed' } }));
      lastReview = review;
    }
    const result = await json(page.request.get(`/api/admin/candidates/${subject.id}/formal-review-results`));
    expect(result.results).toHaveLength(3);
    expect(result.results.every(row => row.items[0].average === 4)).toBe(true);
    const { cycle: pendingCycle } = await json(page.request.post('/api/admin/formal-review-cycles', { data: { title: `P1 atomic ${stamp}`, competencyIds: [Number(competency.id)], periodStart: tomorrow, periodEnd: tomorrow } }));
    createdCycles.push(pendingCycle.id);
    const valid = await json(page.request.post(`/api/admin/formal-review-cycles/${pendingCycle.id}/reviews`, { data: { subjectCandidateId: Number(subject.id) } }));
    await json(page.request.post(`/api/admin/formal-review-cycles/${pendingCycle.id}/reviews`, { data: { subjectCandidateId: Number(manager.id) } }));
    expect((await page.request.post(`/api/admin/formal-review-cycles/${pendingCycle.id}/publish`, { data: {} })).ok()).toBe(false);
    expect((await json(page.request.get(`/api/admin/formal-reviews/${valid.review.id}`))).review.status).toBe('draft');
    expect((await json(page.request.get(`/api/admin/formal-reviews/${valid.review.id}`))).review.raters).toHaveLength(0);
    const historical = await json(page.request.get(`/api/admin/formal-reviews/${lastReview.id}`));
    expect(historical.review.raters.every(r => r.openAnswers[0].answer === 'Contribuição registrada.')).toBe(true);
    const plansBefore = await json(page.request.get(`/api/admin/candidates/${subject.id}/development-plans`));
    console.log('Validating result/PDI UI');
    await page.goto(`/dashboard?tab=team&candidate=${subject.id}&section=journey`, { waitUntil: 'domcontentloaded' });
    const section = page.getByRole('region', { name: 'Resultados de avaliações', exact: true });
    await expect(section, browserErrors.join('\n')).toBeVisible({ timeout: 20000 });
    await section.locator('summary').first().click();
    await expect(section).toContainText('Média 4/5');
    await expect(section.locator('summary').first()).toContainText(today.split('-').reverse().join('/'));
    await section.screenshot({ path: '/private/tmp/p1-results-polish-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    // Escape closes the person detail itself; assert the mobile menu is closed instead.
    await expect(page.locator('.db-sidebar')).not.toBeInViewport();
    const bounds = await section.boundingBox();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await section.screenshot({ path: '/private/tmp/p1-results-polish-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await section.getByRole('button', { name: 'Usar no PDI', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /cancelar/i }).last().click();
    expect((await json(page.request.get(`/api/admin/candidates/${subject.id}/development-plans`))).items.length).toBe(plansBefore.items.length);
    await section.getByRole('button', { name: 'Usar no PDI', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    const created = page.waitForResponse(response => response.url().endsWith(`/candidates/${subject.id}/development-plans`) && response.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: /confirmar/i }).click();
    await json(created);
    expect((await json(page.request.get(`/api/admin/candidates/${subject.id}/development-plans`))).items.length).toBe(plansBefore.items.length + 1);
    expect((await json(page.request.get(`/api/admin/formal-reviews/${lastReview.id}`))).review.scores).toEqual(historical.review.scores);
    await page.route(`**/api/admin/candidates/${subject.id}/formal-review-results`, route => route.fulfill({ status: 500, json: { error: 'Test failure' } }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(section.getByRole('alert')).toContainText('Não foi possível carregar os resultados.');
    await expect(section.locator('details')).toHaveCount(0);
    await page.unroute(`**/api/admin/candidates/${subject.id}/formal-review-results`);
    await section.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(section.locator('details')).toHaveCount(3);
    await page.goto('/dashboard?tab=performance-reviews');
    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: `P1 360 ${stamp}`, exact: true }) }).getByRole('button').click();
    const configuration = page.getByRole('region', { name: 'Configuração do ciclo', exact: true });
    await expect(configuration).toContainText(today.split('-').reverse().join('/'));
    await expect(configuration).toContainText('Competências (1)');
    await expect(configuration).toContainText('Qual foi sua contribuição?');
    await configuration.screenshot({ path: '/private/tmp/p1-cycle-polish-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    expect(await configuration.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await configuration.screenshot({ path: '/private/tmp/p1-cycle-polish-mobile.png' });
  } finally {
    // Only exact synthetic IDs created by this test.
    await db.query('DELETE FROM formal_review_open_answers WHERE rater_id IN (SELECT rr.id FROM formal_review_raters rr JOIN formal_reviews r ON r.id = rr.review_id WHERE r.cycle_id = ANY($1::bigint[]))', [createdCycles]);
    await db.query('DELETE FROM formal_review_cycles WHERE id = ANY($1::bigint[])', [createdCycles]);
    await db.query('DELETE FROM time_clock_person_history WHERE candidate_id = ANY($1::bigint[])', [createdPeople]);
    await db.query('DELETE FROM candidates WHERE id = ANY($1::bigint[])', [createdPeople]);
    if (competencyId) await db.query('DELETE FROM company_competencies WHERE id = $1', [competencyId]);
    await db.end();
  }
});
