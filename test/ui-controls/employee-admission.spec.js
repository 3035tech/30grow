import { test,expect } from '@playwright/test';

async function chooseYear(page,dialog,label,year) {
  await dialog.getByLabel(label,{exact:true}).click();
  const input=page.getByRole('textbox',{name:'Ano',exact:true});
  await input.fill(String(year));await input.press('Tab');
  const month=String(new Date().getMonth()+1).padStart(2,'0');
  const date=`${year}-${month}-01`;
  await page.locator(`[data-day="${date}"]`).click();
  return date;
}


test('hiring stage records a forecast without requesting employee email, access or integration',async({page})=>{
  await page.goto('/onboarding-stages');
  await page.getByRole('button',{name:'Contratar',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Registrar contratação em andamento',exact:true});
  await expect(dialog).toContainText('Não ativa o vínculo de colaborador');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByLabel('E-mail corporativo (opcional)',{exact:true})).toHaveCount(0);
  const planned=await chooseYear(page,dialog,'Previsão de início (opcional)',2099);
  await dialog.getByRole('button',{name:'Registrar no funil',exact:true}).click();
  await expect(page.getByTestId('result')).toHaveText(JSON.stringify({startDate:planned}));
});

test('actual activation requires work-start confirmation and rejects a future admission date',async({page})=>{
  let posts=0;
  await page.route('**/api/admin/candidates/7/admission',route=>{
    if(route.request().method()==='POST')posts++;
    return route.fulfill({json:{person:{id:7,companyId:3,fullName:'Pessoa de teste',email:'personal@example.test',employmentStatus:'candidate'},hiringLinks:[]}});
  });
  await page.goto('/onboarding-stages'); await page.getByRole('button',{name:'Ativar colaborador',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Ativar vínculo de colaborador',exact:true}).click();
  expect(posts).toBe(0); await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox',{name:'Confirmo que esta pessoa já iniciou o trabalho na empresa.',exact:true}).check();
  await chooseYear(page,dialog,'Data real de admissão',2099);
  await dialog.getByRole('button',{name:'Ativar vínculo de colaborador',exact:true}).click();
  await expect(dialog).toContainText('Ative o vínculo somente quando o trabalho começar.'); expect(posts).toBe(0);
});

test('existing employee mode preserves original admission, skips integration and can defer the invitation',async({page})=>{
  let submitted;
  await page.route('**/api/admin/candidates/7/admission',route=>{
    if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return route.fulfill({json:{ok:true,candidateId:7,employmentStatus:'employee',employeeAccessState:'not_invited',inviteSent:false}});}
    return route.fulfill({json:{person:{id:7,companyId:3,fullName:'Pessoa de teste',email:'personal@example.test',employmentStatus:'candidate'},hiringLinks:[]}});
  });
  await page.goto('/onboarding-stages');await page.getByRole('button',{name:'Ativar colaborador',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('checkbox',{name:'Já trabalha nesta empresa',exact:true}).check();
  await expect(dialog.getByRole('status')).toContainText('0 de 4 etapas selecionadas.');
  const actual=await chooseYear(page,dialog,'Data real de admissão',2020);
  await dialog.getByLabel('E-mail corporativo (opcional)',{exact:true}).fill('corporate@work.example.test');
  await dialog.getByRole('checkbox',{name:'Enviar convite de acesso',exact:true}).uncheck();
  await dialog.getByRole('checkbox',{name:'Confirmo que esta pessoa já iniciou o trabalho na empresa.',exact:true}).check();
  await dialog.getByRole('button',{name:'Ativar vínculo de colaborador',exact:true}).click();
  await expect(page.getByTestId('result')).toContainText('"employmentStatus":"employee"');
  expect(submitted).toMatchObject({startDate:actual,personalEmail:'personal@example.test',corporateEmail:'corporate@work.example.test',entryMode:'existing_employee',onboardingStages:[],sendAccessInvite:false,startedWorking:true});
});
