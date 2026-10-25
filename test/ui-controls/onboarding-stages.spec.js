import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`direct inclusion selects all, clears all and retains individual decisions at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/onboarding-stages');
    await page.getByRole('button', { name: 'Incluir colaborador', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await expect(dialog.getByRole('status')).toContainText('4 de 4 etapas selecionadas.');
    await expect(dialog.getByRole('button', { name: 'Marcar todas', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Desmarcar todas', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('O convite de acesso é independente.');
    await expect(dialog.getByRole('button', { name: 'Desmarcar todas', exact: true })).toBeDisabled();
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('stage-selection-mobile.png'), fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Marcar todas', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(4);
    const d30 = dialog.getByRole('checkbox', { name: 'Acompanhamento de 30 dias', exact: true });
    await d30.uncheck();
    await d30.press('Space');
    await expect(d30).toBeChecked();
    await d30.press('Space');
    await expect(dialog.getByRole('status')).toContainText('3 de 4 etapas selecionadas.');
    await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByTestId('result')).toHaveText(JSON.stringify({ onboardingStages: ['arrival','d60','d90'] }));
  });
  test(`actual employee activation can dispense every onboarding stage at ${width}px`, async ({ page }) => {
    await page.route('**/api/admin/candidates/7/admission',route => route.fulfill({json:route.request().method()==='GET'
      ? {person:{id:7,companyId:3,fullName:'Pessoa de teste',email:'personal@example.test',employmentStatus:'candidate'},hiringLinks:[]}
      : {ok:true,candidateId:7,employmentStatus:'employee',employeeAccessState:'not_invited',inviteSent:false}}));
    await page.setViewportSize({ width, height: 900 }); await page.goto('/onboarding-stages');
    await page.getByRole('button', { name: 'Ativar colaborador', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Ativar Pessoa de teste como colaborador', exact: true });
    const stages = dialog.getByRole('group',{name:'Etapas que este colaborador realizará',exact:true});
    await expect(stages.getByRole('checkbox', { checked: true })).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Desmarcar todas', exact: true }).click();
    await expect(stages.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(dialog.getByRole('status')).toContainText('0 de 4 etapas selecionadas.');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole('checkbox',{name:'Confirmo que esta pessoa já iniciou o trabalho na empresa.',exact:true}).check();
    const posted = page.waitForRequest(request => request.method()==='POST' && request.url().endsWith('/7/admission'));
    await dialog.getByRole('button', { name: 'Ativar vínculo de colaborador', exact: true }).click();
    expect((await posted).postDataJSON()).toMatchObject({onboardingStages:[],startedWorking:true,personalEmail:'personal@example.test'});
    await expect(page.getByTestId('result')).toContainText('"employmentStatus":"employee"');
    await expect(dialog).toHaveCount(0);
  });
}
