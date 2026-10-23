import { test,expect } from '@playwright/test';
async function setup(page,{done=true}={}){
 let preDone=done;const bodies=[];
 await page.route('**/api/admin/candidates/7/pre-onboarding',route=>{
  if(route.request().method()==='PATCH')preDone=true;
  return route.fulfill({json:{items:[{id:1,itemKey:'welcome_kit',label:'Kit de teste',ownerRole:'rh',status:preDone?'done':'pending',dueDate:'2026-01-01'}]}});
 });
 await page.route('**/api/admin/candidates/7/onboarding-checkins',route=>route.fulfill({json:{items:[{id:2,milestoneDays:30,status:'done',outcome:'pass',dueDate:'2026-02-01'}]}}));
 await page.route('**/api/admin/benefit-categories?*',route=>route.fulfill({json:{ok:true,categories:[{id:4,name:'Categoria existente'}]}}));
 await page.route('**/api/admin/company-benefits?*',route=>route.fulfill({json:{ok:true,benefits:[{id:3,name:'Benefício existente',benefitType:'other',categoryId:4,category:'Categoria existente'}]}}));
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
test('editing a benefit exposes type and preserves the existing category by omitting it from the patch',async({page})=>{
 const bodies=await setup(page);await page.getByRole('button',{name:'Editar',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Benefício da Empresa',exact:true});await expect(dialog.getByRole('combobox',{name:'Tipo',exact:true})).toBeVisible();
 await expect(dialog.getByRole('combobox',{name:'Categoria',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Salvar',exact:true}).click();await expect(dialog).toBeHidden();expect(bodies).toHaveLength(1);expect(bodies[0]).not.toHaveProperty('categoryId');expect(bodies[0].benefitType).toBe('other');
});
