const {test, expect} = require('@playwright/test');
const cycle = (id, title) => ({id,title,status:'active',startsOn:'2026-01-01',endsOn:'2026-12-31',progressPct:null,areas:[]});
const pack = c => ({cycles:[{id:c.id,title:c.title,status:c.status,startsOn:c.startsOn,endsOn:c.endsOn}],cycle:c});
test('company switch ignores late responses and pt-PT uses Portuguese', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  await page.route('**/api/admin/okr/hierarchy?*', async route => {
    const first = new URL(route.request().url()).searchParams.get('companyId') === '1';
    if (first) { started(); await gate; }
    await route.fulfill({json:pack(cycle(first?1:2,first?'Ciclo antigo':'Ciclo correto'))});
  });
  await page.goto('/okr'); await requested;
  await page.getByRole('button',{name:'Empresa 2'}).click();
  const picker = page.getByRole('combobox',{name:'Ciclo OKR ativo'});
  await expect(picker).toContainText('Ciclo correto');
  release();
  await expect(page.getByRole('button',{name:'Novo ciclo'})).toBeVisible();
  await expect(picker).toContainText('Ciclo correto');
});
test('successful write plus failed refresh does not invite duplicate creation', async ({page}) => {
  let writes = 0;
  await page.route('**/api/admin/okr/**', async route => {
    if(route.request().method()==='POST') { writes++; return route.fulfill({json:{cycle:cycle(2,'Novo')}}); }
    if(writes) return route.fulfill({status:503,json:{error:'refresh failed'}});
    return route.fulfill({json:pack(cycle(1,'Atual'))});
  });
  await page.goto('/okr');
  await page.getByRole('button',{name:'Nova área'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título',{exact:true}).fill('Novo');
  await dialog.getByRole('button',{name:'Salvar',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Alteração salva, mas a atualização da tela falhou. Recarregue os OKRs para conferir.')).toBeVisible();
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  expect(writes).toBe(1);
});
test('OKR workspace remains legible with several areas and objectives', async ({page}) => {
  const data = cycle(1, 'Crescimento sustentável • 2026');
  data.progressPct = 45;
  data.areas = ['Comercial', 'Produto'].map((title, i) => ({id:i+1,title,progressPct:45,activities:[],objectives:[1,2].map(n => ({id:i*10+n,title:n===1?'Aumentar a previsibilidade das vendas':'Melhorar a experiência dos clientes',description:'Acompanhar resultados mensuráveis durante o ciclo.',ownerName:'Mariana Costa',periodEnd:'2026-12-31',progressPct:45,keyResults:[{id:i*100+n,title:'Reduzir o tempo médio de negociação',unit:'dias',startValue:30,targetValue:10,currentValue:21,weight:2,progressPct:45,deadline:'2026-11-30',assignees:[{candidateId:1,fullName:'Mariana Costa'}]}]}))}));
  data.areas[0].objectives[0].keyResults.push({...data.areas[0].objectives[0].keyResults[0],id:999,title:'Elevar a taxa de conversão'});
  await page.route('**/api/admin/okr/hierarchy?*', route => route.fulfill({json:pack(data)}));
  await page.goto('/okr');
  await expect(page.getByRole('combobox',{name:'Ciclo OKR ativo'})).toBeVisible();
  const area = page.getByRole('combobox',{name:'Área',exact:true});
  await area.click();
  await page.getByRole('option',{name:'Produto',exact:true}).click();
  await expect(page.getByRole('region',{name:'Área: Comercial',exact:true})).not.toBeVisible();
  const product = page.getByRole('region',{name:'Área: Produto',exact:true});
  const collapsed = product.getByRole('button',{name:/^Melhorar a experiência/});
  await expect(collapsed).toHaveAttribute('aria-expanded','false');
  await collapsed.click();
  await expect(collapsed).toHaveAttribute('aria-expanded','true');
  await collapsed.click();
  await area.click();
  await page.getByRole('option',{name:'Todas as áreas',exact:true}).click();
  const commercial = page.getByRole('region',{name:'Área: Comercial',exact:true});
  const rows = commercial.getByRole('listitem');
  await expect(commercial.getByRole('definition')).toHaveCount(0);
  await expect(rows.first().getByRole('button',{name:'Registrar check-in',exact:true})).toBeVisible();
  await rows.first().getByRole('button',{name:'Ver detalhes',exact:true}).click();
  await expect(rows.first().getByRole('definition')).toHaveCount(4);
  await rows.nth(1).getByRole('button',{name:'Ver detalhes',exact:true}).click();
  await expect(rows.first().getByRole('definition')).toHaveCount(0);
  await expect(rows.nth(1).getByRole('definition')).toHaveCount(4);
  await rows.nth(1).getByRole('button',{name:'Fechar detalhes',exact:true}).click();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`okr-${width}.png`),fullPage:true});
  }
});
