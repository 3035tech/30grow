import { test,expect } from '@playwright/test';
async function setup(page,{done=true,categories=[{id:4,name:'Categoria existente'}],benefit={id:3,name:'Benefício existente',benefitType:'other',categoryId:4,category:'Categoria existente'}}={}){
 let preDone=done;const bodies=[];
 await page.route('**/api/admin/candidates/7/pre-onboarding',route=>{
  if(route.request().method()==='PATCH')preDone=true;
  return route.fulfill({json:{items:[{id:1,itemKey:'welcome_kit',label:'Kit de teste',ownerRole:'rh',status:preDone?'done':'pending',dueDate:'2026-01-01'}]}});
 });
 await page.route('**/api/admin/candidates/7/onboarding-checkins',route=>route.fulfill({json:{items:[{id:2,milestoneDays:30,status:'done',outcome:'pass',dueDate:'2026-02-01'}]}}));
 await page.route('**/api/admin/benefit-categories?*',route=>route.fulfill({json:{ok:true,categories}}));
 await page.route('**/api/admin/company-benefits?*',route=>route.fulfill({json:{ok:true,benefits:[benefit]}}));
 await page.route('**/api/admin/company-benefits',route=>{bodies.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,benefit:{id:5}}});});
 await page.route('**/api/admin/company-benefits/3',route=>{bodies.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});});
 await page.goto('/hr-feedback');return bodies;
}
test('completed hiring and post-hire checklists stay compact and can be reopened',async({page})=>{
 await setup(page);
 for(const title of ['Check-ins de contratação','Check-ins pós-contratação']){
  const toggle=page.getByRole('button',{name:new RegExp('^'+title)});await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toContainText('1/1');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
 }
 await expect(page.getByText('Kit de teste',{exact:true})).toBeVisible();
});
test('finishing the last hiring item collapses the checklist automatically',async({page})=>{
 await setup(page,{done:false});const toggle=page.getByRole('button',{name:/^Check-ins de contratação/});await expect(toggle).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Feito',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Kit de teste',exact:true});
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toContainText('1/1');
});
test('editing a benefit exposes its category and sends the selected category id',async({page})=>{
 const bodies=await setup(page);await page.getByRole('button',{name:'Editar',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Benefício da Empresa',exact:true});await expect(dialog.getByRole('combobox',{name:'Tipo',exact:true})).toBeVisible();
 await expect(dialog.getByRole('combobox',{name:'Categoria',exact:true})).toContainText('Categoria existente');
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();await expect(dialog).toBeHidden();expect(bodies).toHaveLength(1);expect(bodies[0].categoryId).toBe(4);expect(bodies[0].benefitType).toBe('other');
});
test('new benefit sends the chosen category',async({page})=>{
 const bodies=await setup(page);await page.getByRole('button',{name:'Novo benefício',exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'Benefício da Empresa',exact:true});
 await dialog.getByRole('textbox',{name:'Nome',exact:true}).fill('Vale alimentação');
 await dialog.getByRole('combobox',{name:'Categoria',exact:true}).click();
 await page.getByRole('option',{name:'Categoria existente',exact:true}).click();
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();
 await expect(dialog).toBeHidden();expect(bodies).toHaveLength(1);expect(bodies[0].categoryId).toBe(4);
});
test('without categories, new benefit opens category management first',async({page})=>{
 await setup(page,{categories:[]});await page.getByRole('button',{name:'Novo benefício',exact:true}).first().click();
 await expect(page.getByRole('dialog',{name:'Gerenciar categorias',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Nova categoria',exact:true}).first()).toBeVisible();
});
test('editing a benefit keeps its inactive category without reassigning it',async({page})=>{
 const bodies=await setup(page,{categories:[]});await page.getByRole('button',{name:'Editar',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Benefício da Empresa',exact:true});
 await expect(dialog.getByRole('combobox',{name:'Categoria',exact:true})).toContainText('Categoria existente');
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();
 expect(bodies).toHaveLength(1);expect(bodies[0]).not.toHaveProperty('categoryId');
});
test('editing a legacy text category keeps it until another category is chosen',async({page})=>{
 const bodies=await setup(page,{benefit:{id:3,name:'Benefício existente',benefitType:'other',categoryId:null,category:'Categoria legada'}});
 await page.getByRole('button',{name:'Editar',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Benefício da Empresa',exact:true});
 await expect(dialog.getByRole('combobox',{name:'Categoria',exact:true})).toContainText('Categoria legada');
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();
 expect(bodies).toHaveLength(1);expect(bodies[0]).not.toHaveProperty('categoryId');
});
