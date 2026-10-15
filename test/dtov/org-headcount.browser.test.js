import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';
import { dismissManagerOnboarding } from '../e2e/fixtures.js';
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);
const { query, pool } = await import('../../lib/db.js');
const base = 'http://127.0.0.1:3010';
const suffix = String(Date.now()).slice(-7);
const login = await fetch(base + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'hr@todos-os-dados.demo',
    password: 'DemoTodosDados!2026',
    locale: 'pt-BR',
  }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((v) => v.split(';')[0])
  .join('; ');
const request = (path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: { cookie, 'Content-Type': 'application/json', ...options.headers },
  });
let checks = 0;
const api = async (method, body, expected = 200, params = '') => {
  const response = await request('/api/admin/org-positions' + params, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  checks++;
  return data;
};
const companyId = Number(
  (await query("SELECT company_id FROM users WHERE email='hr@todos-os-dados.demo'")).rows[0]
    .company_id,
);
const roleName = `HC Role ${suffix}`;
const roleId = Number(
  (
    await query('INSERT INTO job_roles(company_id,name) VALUES($1,$2) RETURNING id', [
      companyId,
      roleName,
    ])
  ).rows[0].id,
);
const employeeName = `HC Employee ${suffix}`;
const employeeId = Number(
  (
    await query(
      "INSERT INTO candidates(company_id,full_name,email,employment_status) VALUES($1,$2,$3,'employee') RETURNING id",
      [companyId, employeeName, `hc-ui-${suffix}@dtov.invalid`],
    )
  ).rows[0].id,
);
const vacancyId = Number(
  (
    await query(
      'INSERT INTO vacancies(company_id,title,slug,job_role_id,positions_count) VALUES($1,$2,$3,$4,1) RETURNING id',
      [companyId, `HC Vacancy ${suffix}`, `hc-ui-${suffix}`, roleId],
    )
  ).rows[0].id,
);
const candidateIds = [employeeId],
  positions = [];
let restrictedId, foreignCompany;
let unitId;
let extraVacancyId;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
await context.addCookies(
  cookie.split('; ').map((v) => {
    const i = v.indexOf('=');
    return { name: v.slice(0, i), value: v.slice(i + 1), url: base };
  }),
);
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dir = '/private/tmp/team30-headcount-qa';
await mkdir(dir, { recursive: true });
const select = async (label, option, root = page) => {
  await root.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};
try {
  assert.equal((await fetch(base + '/api/admin/org-positions')).status, 401);
  checks++;
  await page.goto(base + '/dashboard?tab=organization');
  await page.waitForLoadState('networkidle');
  await dismissManagerOnboarding(page);
  await page.getByRole('button', { name: /^Criar (primeira )?unidade$/ }).click();
  const unitForm = page.getByRole('dialog', { name: 'Criar unidade', exact: true });
  await unitForm.getByLabel('Nome da unidade', { exact: true }).fill(`HC Unit ${suffix}`);
  await select('Tipo de unidade', 'Departamento', unitForm);
  await unitForm.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(unitForm).toBeHidden();
  unitId = Number(
    (
      await query('SELECT id FROM org_units WHERE company_id=$1 AND name=$2', [
        companyId,
        `HC Unit ${suffix}`,
      ])
    ).rows[0].id,
  );
  assert.equal(
    (await query('SELECT unit_type FROM org_units WHERE id=$1', [unitId])).rows[0].unit_type,
    'department',
  );
  checks++;
  await page.getByRole('tab', { name: 'Posições e headcount', exact: true }).click();
  await page.getByRole('button', { name: 'Nova posição', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nova posição', exact: true });
  const code = `HC-${suffix}`;
  await form.getByLabel('Código da posição', { exact: true }).fill(code);
  await form.getByLabel('Nome da posição', { exact: true }).fill(`Engineer ${suffix}`);
  await select('Unidade', `HC Unit ${suffix}`, form);
  await select('Cargo', roleName, form);
  await form.getByLabel('Vigente desde', { exact: true }).fill('2026-01-01');
  await form.getByRole('button', { name: 'Salvar planejamento', exact: true }).click();
  await expect(form).toBeHidden();
  const position = async () => {
    const data = await api('GET', null, 200, `?q=${code}`);
    assert.equal(data.items.length, 1);
    return data.items[0];
  };
  let p = await position();
  positions.push(Number(p.id));
  assert.equal(p.status, 'planned');
  checks++;
  foreignCompany = Number(
    (
      await query(
        "INSERT INTO companies(name,slug) VALUES('Headcount private fixture',$1) RETURNING id",
        [`hc-private-${suffix}`],
      )
    ).rows[0].id,
  );
  const privateUnit = Number(
    (
      await query("INSERT INTO org_units(company_id,name) VALUES($1,'Private') RETURNING id", [
        foreignCompany,
      ])
    ).rows[0].id,
  );
  const privateRole = Number(
    (
      await query("INSERT INTO job_roles(company_id,name) VALUES($1,'Private') RETURNING id", [
        foreignCompany,
      ])
    ).rows[0].id,
  );
  const privatePosition = Number(
    (
      await query(
        "INSERT INTO org_positions(company_id,code,title,org_unit_id,job_role_id) VALUES($1,'PRIVATE-SECRET','Private seat',$2,$3) RETURNING id",
        [foreignCompany, privateUnit, privateRole],
      )
    ).rows[0].id,
  );
  const scoped = await api('GET', null, 200, `?companyId=${foreignCompany}&q=PRIVATE-SECRET`);
  assert.equal(scoped.items.length, 0);
  checks++;
  await api(
    'PATCH',
    { action: 'status', positionId: privatePosition, version: 1, status: 'approved' },
    404,
  );
  const restrictedEmail = `hc-limited-${suffix}@dtov.invalid`;
  restrictedId = Number(
    (
      await query(
        "INSERT INTO users(company_id,email,password_hash,role) SELECT company_id,$1,password_hash,'hr' FROM users WHERE email='hr@todos-os-dados.demo' RETURNING id",
        [restrictedEmail],
      )
    ).rows[0].id,
  );
  await query(
    "INSERT INTO user_capability_overrides(user_id,capability) VALUES($1,'profile.self'),($1,'team.view')",
    [restrictedId],
  );
  const limitedLogin = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: restrictedEmail, password: 'DemoTodosDados!2026' }),
  });
  assert.equal(limitedLogin.status, 200);
  const limitedCookie = limitedLogin.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  const limited = (method, body) =>
    fetch(base + '/api/admin/org-positions', {
      method,
      headers: { cookie: limitedCookie, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await limited('GET')).status, 200);
  checks++;
  assert.equal(
    (await limited('PATCH', { action: 'link', positionId: Number(p.id), vacancyId })).status,
    403,
  );
  checks++;
  await query("DELETE FROM user_capability_overrides WHERE user_id=$1 AND capability='team.view'", [
    restrictedId,
  ]);
  assert.equal((await limited('GET')).status, 403);
  checks++;

  const row = () => page.getByRole('row').filter({ hasText: code });
  await row().getByRole('button', { name: 'Aprovar posição', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Aprovar posição', exact: true });
  await approval.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(row().getByRole('button', { name: 'Alocar pessoa', exact: true })).toBeVisible();
  checks++;
  await row().getByRole('button', { name: 'Alocar pessoa', exact: true }).click();
  const allocation = page.getByRole('dialog', { name: 'Alocar pessoa', exact: true });
  await allocation.getByRole('combobox', { name: 'Colaborador', exact: true }).fill(employeeName);
  await allocation.getByRole('option').filter({ hasText: employeeName }).click();
  await allocation
    .getByLabel('Motivo da movimentação', { exact: true })
    .fill('Allocation for browser validation');
  await allocation.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await expect(allocation).toBeHidden();
  await expect(row().getByText(employeeName, { exact: true })).toBeVisible();
  checks++;
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.screenshot({
    path: `${dir}/headcount-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.screenshot({
    path: `${dir}/headcount-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  checks++;
  await page.getByRole('button', { name: 'Ativar modo escuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({
    path: `${dir}/headcount-mobile-dark.png`,
    fullPage: true,
    animations: 'disabled',
  });
  checks++;
  await page.setViewportSize({ width: 1365, height: 900 });
  await row().getByRole('button', { name: 'Liberar posição', exact: true }).click();
  const release = page.getByRole('dialog', { name: 'Liberar posição', exact: true });
  await release.getByLabel('Motivo da movimentação', { exact: true }).fill('Vacancy preparation');
  await release.getByRole('button', { name: 'Confirmar movimentação', exact: true }).click();
  await expect(release).toBeHidden();
  await expect(row().getByRole('button', { name: 'Vincular vaga', exact: true })).toBeVisible();
  await row().getByRole('button', { name: 'Vincular vaga', exact: true }).click();
  const linking = page.getByRole('dialog', { name: 'Vincular vaga', exact: true });
  await linking
    .getByRole('combobox', { name: 'Vaga de recrutamento', exact: true })
    .fill(`HC Vacancy ${suffix}`);
  await linking
    .getByRole('option')
    .filter({ hasText: `HC Vacancy ${suffix}` })
    .click();
  await linking.getByRole('button', { name: 'Vincular vaga', exact: true }).click();
  await expect(linking).toBeHidden();
  checks++;
  // Both HTTP hiring paths must atomically enforce the same structural capacity.
  const makeCandidate = async (name) => {
    const id = Number(
      (
        await query(
          'INSERT INTO candidates(company_id,full_name,email) VALUES($1,$2,$3) RETURNING id',
          [companyId, name, `${name}-${suffix}@dtov.invalid`],
        )
      ).rows[0].id,
    );
    candidateIds.push(id);
    return id;
  };
  const first = await makeCandidate('HeadcountHireA'),
    second = await makeCandidate('HeadcountHireB');
  for (const id of [first, second])
    await query(
      'INSERT INTO vacancy_candidates(company_id,vacancy_id,candidate_id) VALUES($1,$2,$3)',
      [companyId, vacancyId, id],
    );
  const hire = async (id, expected) => {
    const response = await request(`/api/admin/vacancies/${vacancyId}/candidates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pipelineStage: 'hired', startDate: '2026-10-15' }),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    checks++;
  };
  await hire(first, 200);
  await hire(first, 200);
  await hire(second, 409);
  assert.equal(
    (await query('SELECT employment_status FROM candidates WHERE id=$1', [second])).rows[0]
      .employment_status,
    'candidate',
  );
  checks++;
  const areaId = (await query('SELECT id FROM areas ORDER BY id LIMIT 1')).rows[0].id;
  const assessmentId = Number(
    (
      await query(
        "INSERT INTO assessments(company_id,candidate_id,vacancy_id,area_id,top_type,scores,pipeline_stage) VALUES($1,$2,$3,$4,1,'{}','approved') RETURNING id",
        [companyId, second, vacancyId, areaId],
      )
    ).rows[0].id,
  );
  const blocked = await request(`/api/admin/assessments/${assessmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pipelineStage: 'hired', startDate: '2026-10-15' }),
  });
  assert.equal(blocked.status, 409, await blocked.text());
  assert.equal(
    (await query('SELECT pipeline_stage FROM assessments WHERE id=$1', [assessmentId])).rows[0]
      .pipeline_stage,
    'approved',
  );
  checks++;
  const newPosition = await api('POST', {
    code: `HC2-${suffix}`,
    title: 'Second structural seat',
    orgUnitId: unitId,
    jobRoleId: roleId,
    fte: 0.5,
    effectiveFrom: '2026-01-01',
  });
  positions.push(Number(newPosition.id));
  await api('PATCH', {
    action: 'status',
    positionId: Number(newPosition.id),
    version: 1,
    status: 'approved',
  });
  extraVacancyId = Number(
    (
      await query(
        'INSERT INTO vacancies(company_id,title,slug,job_role_id,positions_count) VALUES($1,$2,$3,$4,1) RETURNING id',
        [companyId, `HC Vacancy Two ${suffix}`, `hc-two-${suffix}`, roleId],
      )
    ).rows[0].id,
  );
  await api('PATCH', {
    action: 'link',
    positionId: Number(newPosition.id),
    vacancyId: extraVacancyId,
  });
  await query('UPDATE assessments SET vacancy_id=$2 WHERE id=$1', [assessmentId, extraVacancyId]);
  const hired = await request(`/api/admin/assessments/${assessmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pipelineStage: 'hired', startDate: '2026-10-15' }),
  });
  assert.equal(hired.status, 200, await hired.text());
  checks++;
  const proof = await query(
    'SELECT c.org_unit_id,c.job_role_id,a.position_id FROM candidates c JOIN org_position_assignments a ON a.candidate_id=c.id AND a.ended_on IS NULL WHERE c.id=$1',
    [second],
  );
  assert.equal(Number(proof.rows[0].position_id), Number(newPosition.id));
  assert.equal(proof.rows[0].org_unit_id, unitId);
  checks++;
  await page.goto(
    base + `/dashboard?tab=vacancies&vacancyDetail=${vacancyId}&vacancySection=pipeline`,
  );
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Posições estruturais vinculadas', { exact: true })).toBeVisible();
  await expect(page.getByText(/Preenchida nesta vaga/)).toBeVisible();
  checks++;
  await api(
    'POST',
    {
      code: 'invalid',
      title: 'invalid',
      orgUnitId: unitId,
      jobRoleId: roleId,
      fte: 2,
      effectiveFrom: '2026-01-01',
    },
    400,
  );
  assert.deepEqual(errors, []);
  checks++;
  console.log(`Headcount HTTP/browser: ${checks} checks passed`);
} catch (error) {
  await page.screenshot({ path: dir + '/failure.png', fullPage: true });
  throw error;
} finally {
  await context.close();
  await browser.close();
  const remaining = (
    await query('SELECT id FROM org_positions WHERE company_id=$1 AND job_role_id=$2', [
      companyId,
      roleId,
    ])
  ).rows.map((row) => Number(row.id));
  positions.push(...remaining);
  if (positions.length) {
    await query(
      'DELETE FROM org_position_recruitments WHERE company_id=$1 AND position_id=ANY($2::bigint[])',
      [companyId, positions],
    );
    await query(
      'DELETE FROM org_position_assignments WHERE company_id=$1 AND position_id=ANY($2::bigint[])',
      [companyId, positions],
    );
    await query('DELETE FROM org_positions WHERE company_id=$1 AND id=ANY($2::bigint[])', [
      companyId,
      positions,
    ]);
  }
  if (restrictedId) await query('DELETE FROM users WHERE id=$1', [restrictedId]);
  if (foreignCompany) {
    await query('DELETE FROM org_positions WHERE company_id=$1', [foreignCompany]);
    await query('DELETE FROM org_units WHERE company_id=$1', [foreignCompany]);
    await query('DELETE FROM companies WHERE id=$1', [foreignCompany]);
  }
  await query('DELETE FROM candidates WHERE id=ANY($1::bigint[])', [candidateIds]);
  await query('DELETE FROM job_funnel_events WHERE vacancy_id=ANY($1::bigint[])', [
    [vacancyId, ...(extraVacancyId ? [extraVacancyId] : [])],
  ]);
  await query('DELETE FROM vacancies WHERE id=ANY($1::bigint[])', [
    [vacancyId, ...(extraVacancyId ? [extraVacancyId] : [])],
  ]);
  await query('DELETE FROM job_roles WHERE id=$1', [roleId]);
  if (unitId) await query('DELETE FROM org_units WHERE id=$1', [unitId]);
  await pool.end();
}
