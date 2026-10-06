const {test, expect} = require('@playwright/test');

test('detail navigation keeps a page title, focus and back action; historical totals are not badges', async ({page}) => {
  await page.goto('/employee');
  await expect(page.getByRole('heading',{level:1})).toHaveText('Olá, Pessoa de teste');
  // Use the shared sidebar's visible links, independent of translated nav landmarks.
  await expect(page.locator('#employee-sidebar a[href="/employee#feed"]')).not.toContainText('42');
  await expect(page.locator('#employee-sidebar a[href="/employee#kudos"]')).not.toContainText('17');
  await page.locator('#employee-sidebar a[href="/employee#okr"]').click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Minhas metas');
  await expect(page.locator('#employee-detail-title')).toBeFocused();
  await expect(page.locator('#okr')).toBeVisible();
  await page.getByRole('button',{name:'Voltar para Hoje'}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Olá, Pessoa de teste');
  await page.locator('#employee-sidebar a[href="/employee/pdi"]').click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Meu desenvolvimento');
  await page.getByRole('link',{name:/Voltar ao início/}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Olá, Pessoa de teste');
});

test('2FA status cannot show disabled on failure or malformed data and retry recovers', async ({page}) => {
  let mode = 'error';
  await page.route('**/api/employee/me/2fa', route => route.fulfill({status:mode==='error'?503:200,json:mode==='malformed'?{}:{enabled:mode==='enabled'}}));
  await page.goto('/employee/profile');
  await page.getByRole('tab',{name:'Segurança',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/Não foi possível/})).toContainText('Não foi possível consultar');
  await expect(page.getByText('2FA desativado.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Configurar 2FA'})).toHaveCount(0);
  mode = 'malformed';
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/Não foi possível/})).toContainText('Não foi possível consultar');
  mode = 'enabled';
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(page.getByText('2FA ativo: exigido no login.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Configurar 2FA'})).toHaveCount(0);
});

test('2FA pending status is explicit during retry', async ({page}) => {
  let recovered = false;
  await page.route('**/api/employee/me/2fa', async route => {
    if (recovered) await new Promise(resolve=>setTimeout(resolve,800));
    await route.fulfill({status:recovered?200:503,json:{enabled:false}});
  });
  await page.goto('/employee/profile');
  await page.getByRole('tab',{name:'Segurança',exact:true}).click();
  recovered = true;
  await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Consultando'})).toBeVisible();
  await expect(page.getByText('2FA desativado.',{exact:true})).toHaveCount(0);
  await expect(page.getByText('2FA desativado.',{exact:true})).toBeVisible();
});

test('mobile drawer isolates background, traps Tab and restores focus on Escape and resize', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/employee');
  await expect(page.locator('#employee-sidebar')).toHaveAttribute('inert','');
  const trigger = page.getByRole('button',{name:'Abrir menu',exact:true});
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-modal','true');
  await expect(page.locator('main').locator('..')).toHaveAttribute('inert','');
  const first = dialog.locator('a[href], button:not(:disabled)').filter({visible:true}).first();
  const last = dialog.locator('a[href], button:not(:disabled)').filter({visible:true}).last();
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#employee-sidebar')).not.toHaveAttribute('inert','');
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('login rejection provides recovery and removes stale expired-session notice', async ({page}) => {
  await page.goto('/employee/login?reason=expired');
  await expect(page.getByText('Sua sessão encerrou. Entre de novo para continuar.')).toBeVisible();
  await page.getByLabel('E-mail',{exact:true}).fill('pessoa@example.test');
  await page.getByLabel('Senha',{exact:true}).fill('invalid-fixture-password');
  await page.locator('form').getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:/Não foi possível/})).toContainText('Confira o e-mail e a senha');
  await expect(page.getByText('Não autorizado',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Sua sessão encerrou. Entre de novo para continuar.')).toHaveCount(0);
});

test('headers and contact typography stay consistent across mobile, tablet and desktop', async ({page}) => {
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const [path,title] of [['profile','Meu perfil'],['pdi','Meu desenvolvimento'],['dp','Documentos e dados'],['lms','Meus cursos'],['time-clock','Ponto']]) {
      await page.goto('/employee/'+path);
      await expect(page.getByRole('heading',{level:1})).toHaveText(title);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if (path==='profile') {
        const email = page.getByLabel('E-mail',{exact:true});
        const name = page.getByLabel('Nome completo',{exact:true});
        expect(await email.evaluate(el=>getComputedStyle(el).fontSize)).toBe(await name.evaluate(el=>getComputedStyle(el).fontSize));
        expect(await email.evaluate(el=>getComputedStyle(el).fontFamily)).toBe(await name.evaluate(el=>getComputedStyle(el).fontFamily));
      }
    }
  }
});

test('survey draft survives navigation to a detail screen and uses the standard multiline control', async ({page}) => {
  const writes = [];
  page.on('request', request=>{if(request.url().includes('/api/') && request.method()!=='GET') writes.push(request.url());});
  await page.route('**/api/employee/surveys*', route=>route.fulfill({json:{
    openClimate:[{surveyId:1,title:'Pesquisa de teste',token:'synthetic',questions:[{id:1,prompt:'O que podemos melhorar?',questionKind:'text'}]}],openPulse:[],history:[]
  }}));
  await page.goto('/employee#surveys');
  await page.locator('#surveys').getByRole('button',{name:'Responder',exact:true}).click();
  const answer=page.getByRole('textbox',{name:'O que podemos melhorar?',exact:true});
  await answer.fill('Rascunho que não deve desaparecer ao navegar.');
  expect(await answer.evaluate(el=>el.tagName)).toBe('TEXTAREA');
  expect(await answer.evaluate(el=>parseFloat(getComputedStyle(el).minHeight))).toBeGreaterThanOrEqual(88);
  await page.locator('#employee-sidebar a[href="/employee#okr"]').click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Minhas metas');
  await page.locator('#employee-sidebar a[href="/employee#surveys"]').click();
  await expect(answer).toHaveValue('Rascunho que não deve desaparecer ao navegar.');
  expect(writes).toEqual([]);
});

test('mobile logout confirmation closes the navigation and cancellation keeps the session', async ({page}) => {
  const deletes=[];
  page.on('request',request=>{if(request.method()==='DELETE') deletes.push(request.url());});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/employee');
  await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Sair',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Encerrar sessão?'});
  await expect(confirmation).toBeVisible();
  await expect(page.locator('#employee-sidebar')).toHaveAttribute('inert','');
  await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole('heading',{level:1})).toHaveText('Olá, Pessoa de teste');
  expect(deletes).toEqual([]);
});
