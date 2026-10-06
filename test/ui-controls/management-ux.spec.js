const {test, expect} = require('@playwright/test');

test('RH navigation exposes people modules and hides administration', async ({page}) => {
  await page.goto('/dashboard?tab=team&persona=hr');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Equipe');
  await expect(page.locator('#companies-tab')).toHaveCount(0);
  await expect(page.locator('#users-tab')).toHaveCount(0);
  await page.locator('#pdi-tab').click();
  await expect(page).toHaveURL(/tab=pdi/);
  await expect(page.getByRole('heading',{level:1})).toHaveText('PDI');
  await expect(page.getByRole('table')).toContainText('Pessoa de teste');
});

test('admin navigation and create cancellation keep business data unchanged', async ({page}) => {
  const writes=[];
  page.on('request',r=>{if(r.url().includes('/api/') && r.method()!=='GET') writes.push(r.url());});
  await page.goto('/dashboard?tab=companies&persona=admin');
  await expect(page.locator('#users-tab')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Empresa exemplo');
  const create=page.getByRole('button',{name:'Nova empresa',exact:true}).first();
  await create.click();
  const dialog=page.getByRole('dialog',{name:'Nova empresa',exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
  expect(writes).toEqual([]);
});

test('company form uses readable mobile controls consistent with shared date control', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard?tab=companies&persona=admin');
  await expect(page.getByRole('table')).toContainText('Empresa exemplo');
  await page.getByRole('button',{name:'Nova empresa',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'Nova empresa',exact:true});
  await expect(dialog).toBeVisible();
  const name=dialog.getByRole('textbox',{name:'Nome da empresa',exact:true});
  const font=await name.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),family:getComputedStyle(el).fontFamily,height:el.getBoundingClientRect().height}));
  await page.screenshot({path:test.info().outputPath('company-form-mobile.png')});
  expect.soft(font.size).toBeGreaterThanOrEqual(16);
  expect.soft(font.height).toBeGreaterThanOrEqual(44);
  const date=dialog.getByRole('button',{name:'Aniversário da empresa',exact:true});
  expect.soft(font.family).toBe(await date.evaluate(el=>getComputedStyle(el).fontFamily));
});

test('management mobile menu is modal and isolates background', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard?tab=team&persona=hr');
  await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
  await expect(page.locator('#dashboard-sidebar')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('management-menu-mobile.png')});
  await expect.soft(page.locator('#dashboard-sidebar')).toHaveAttribute('role','dialog');
  await expect.soft(page.locator('#dashboard-sidebar')).toHaveAttribute('aria-modal','true');
  expect.soft(await page.locator('main').evaluate(el=>Boolean(el.closest('[inert]')))).toBe(true);
});

test('management mobile menu contains keyboard focus and restores it on Escape', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard?tab=team&persona=hr');
  const trigger=page.getByRole('button',{name:'Abrir menu',exact:true});
  await trigger.click();
  const last=page.locator('#dashboard-sidebar').getByRole('button',{name:'Sair',exact:true});
  await last.focus();
  await page.keyboard.press('Tab');
  expect.soft(await page.locator('#dashboard-sidebar').evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.soft(trigger).toBeFocused();
});

test('RH security reports 2FA status failure with an accessible recovery action', async ({page}) => {
  await page.goto('/dashboard?tab=profile&persona=hr&twofa=error');
  await page.getByRole('tab',{name:'Segurança',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Alterar senha',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('rh-security-load-failure.png')});
  await expect(page.getByRole('alert').filter({hasText:/2FA|duas etapas|autenticação/i})).toBeVisible();
});

for (const width of [390,768,1440]) {
  test(`management page headings and overflow at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    for (const [tab,persona,title] of [['team','hr','Equipe'],['pdi','hr','PDI'],['profile','hr','Meu perfil'],['companies','admin','Empresas'],['users','admin','Usuários']]) {
      await page.goto(`/dashboard?tab=${tab}&persona=${persona}`);
      await expect(page.getByRole('heading',{level:1})).toHaveText(title);
      if (['pdi','companies','users'].includes(tab)) await expect(page.getByRole('table')).toBeVisible();
      if (tab==='profile') await expect(page.getByRole('tab',{name:'Minha conta',exact:true})).toBeVisible();
      const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      await page.screenshot({path:test.info().outputPath(`${persona}-${tab}-${width}.png`),fullPage:true});
      expect.soft(dimensions.document,`${persona}/${tab}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(width);
    }
  });
}


test('2FA recovery preserves drafts and blocks email changes until status is known', async ({page}) => {
  let recovered=false;
  const writes=[];
  page.on('request',r=>{if(r.url().includes('/api/') && r.method()!=='GET') writes.push(r.url());});
  await page.route('**/api/me/2fa',route=>route.fulfill(recovered
    ? {json:{canUse2Fa:true,enabled:false}}
    : {status:503,json:{error:'Unavailable'}}));
  await page.goto('/dashboard?tab=profile&persona=hr');
  await page.getByRole('textbox',{name:'E-mail',exact:true}).fill('draft@example.test');
  await page.getByLabel('Senha atual',{exact:true}).fill('synthetic-password');
  await expect(page.getByRole('button',{name:'Salvar',exact:true})).toBeDisabled();
  await page.getByRole('tab',{name:'Segurança',exact:true}).click();
  const alert=page.getByRole('alert').filter({hasText:/duas etapas/i});
  await expect(alert).toBeVisible();
  recovered=true;
  await alert.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Configurar 2FA',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Minha conta',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'E-mail',exact:true})).toHaveValue('draft@example.test');
  await expect(page.getByRole('button',{name:'Salvar',exact:true})).toBeEnabled();
  expect(writes).toEqual([]);
});

test('management mobile logout cancellation does not end the session', async ({page}) => {
  const writes=[];
  page.on('request',r=>{if(r.url().includes('/api/') && r.method()!=='GET') writes.push(r.url());});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/dashboard?tab=team&persona=hr');
  await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
  await page.locator('#dashboard-sidebar').getByRole('button',{name:'Sair',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Encerrar sessão?'});
  await expect(confirmation).toBeVisible();
  await expect(page.locator('#dashboard-sidebar')).toHaveAttribute('inert','');
  await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Equipe');
  expect(writes).toEqual([]);
});
