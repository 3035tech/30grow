import {test,expect} from '@playwright/test';
const company={id:1,name:'Empresa de teste financeiro',active:true,deleted:false,ownerId:10,ownerEmail:'dono@example.test',managed:true,category:'active',status:'active',planKey:'brl_small_annual',amount:149000,currency:'brl',interval:'year',periodEnd:'2028-01-01T00:00:00Z',trialEndsAt:'2026-01-01T00:00:00Z',subscriptionId:'sub_fixture',customerId:'cus_fixture',commercialAccess:true,cancelAtPeriodEnd:false};
const invoice={id:'in_fixture',number:'INV-TESTE',status:'paid',currency:'brl',amount:149000,amountPaid:149000,createdAt:'2026-01-01T00:00:00Z',url:'https://invoice.stripe.com/test-fixture'};
async function setup(page,{failOnce=false,invoicesUnavailable=false}={}){
 const bodies=[];
 await page.route('**/api/admin/billing/companies?*',route=>{
  const query=new URL(route.request().url()).searchParams;
  return route.fulfill({json:query.has('companyId')?{configured:true,livemode:false,company,invoices:invoicesUnavailable?[]:[invoice],invoicesUnavailable,operations:[],history:[]}:{configured:true,livemode:false,items:[company],total:1,page:1,pageSize:20,totalPages:1,summary:{total:1,paying:1,trial:0,overdue:0,canceling:0,legacy:0}}});
 });
 await page.route('**/api/admin/billing/operations?*',route=>route.fulfill({json:{invoiceId:invoice.id,invoiceNumber:invoice.number,currency:'brl',paid:149000,chargeId:'ch_fixture',available:149000,annualEligible:true,proportional:34567,periodStart:'2026-01-01T00:00:00Z',periodEnd:'2028-01-01T00:00:00Z',requestedAt:new URL(route.request().url()).searchParams.get('requestedAt'),refunds:[]}}));
 await page.route('**/api/admin/billing/operations',route=>{bodies.push(route.request().postDataJSON());return route.fulfill(failOnce&&bodies.length===1?{status:503,json:{error:'Confirmação pendente de teste'}}:{json:{operation:{id:bodies.at(-1).requestId,status:'succeeded'}}});});
 await page.goto('/subscriptions');await page.getByRole('button',{name:'Ver assinatura',exact:true}).click();
 await expect(page.getByRole('heading',{name:company.name,exact:true})).toBeVisible();return bodies;
}
test('canceling renewal requires confirmation and never requests a refund',async({page})=>{
 const bodies=await setup(page);
 await page.getByRole('button',{name:'Cancelar renovação',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Cancelar renovação',exact:true});
 await expect(dialog.getByText('Mantém o período contratado',{exact:false})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Confirmar operação',exact:true})).toBeDisabled();expect(bodies).toHaveLength(0);
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirmar operação',exact:true}).click();
 await expect(dialog).toBeHidden();expect(bodies).toHaveLength(1);expect(bodies[0].kind).toBe('cancel_renewal');expect(bodies[0].confirmed).toBe(true);expect(bodies[0].invoiceId).toBeUndefined();
});
test('a partial refund keeps its request ID when a provider confirmation is lost',async({page})=>{
 const bodies=await setup(page,{failOnce:true});await page.getByRole('button',{name:'Reembolsar pagamento',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Reembolsar pagamento',exact:true});
 await expect(dialog.getByText('A assinatura continua como está',{exact:false})).toBeVisible();
 await dialog.getByRole('combobox',{name:'Tipo de reembolso',exact:true}).selectOption('partial');
 await dialog.getByLabel('Valor a devolver (BRL)',{exact:true}).fill('125,50');
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirmar operação',exact:true}).click();
 await expect(dialog.getByText('Confirmação pendente de teste')).toBeVisible();
 await dialog.getByRole('button',{name:'Confirmar operação',exact:true}).click();await expect(dialog).toBeHidden();
 expect(bodies).toHaveLength(2);expect(bodies[0].requestId).toBe(bodies[1].requestId);expect(bodies[1].amount).toBe(12550);expect(bodies[1].kind).toBe('refund');
});
test('annual proportional refunds use the server preview and remain separate from termination',async({page})=>{
 const bodies=await setup(page);await page.getByRole('button',{name:'Reembolsar pagamento',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Reembolsar pagamento',exact:true});
 await dialog.getByRole('combobox',{name:'Tipo de reembolso',exact:true}).selectOption('annual');
 await expect(dialog.getByText('Valor a devolver:',{exact:false})).toContainText('345,67');
 await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Confirmar operação',exact:true}).click();await expect(dialog).toBeHidden();
 expect(bodies[0].amount).toBe(34567);expect(bodies[0].basis).toBe('annual');expect(bodies[0].reason).toBe('annual_early_termination');expect(bodies[0].kind).toBe('refund');expect(bodies[0].requestedAt).toBeTruthy();
});
test('financial tables and dialogs remain contained on mobile',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Encerrar assinatura agora',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Encerrar assinatura agora',exact:true});
 await expect(dialog.getByText('Não apaga dados',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('subscriptions-mobile.png'),fullPage:true});
});

test('partial refunds explain invalid amounts beside the field and require renewed confirmation',async({page})=>{
 const bodies=await setup(page);await page.getByRole('button',{name:'Reembolsar pagamento',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Reembolsar pagamento',exact:true});
 await dialog.getByRole('combobox',{name:'Tipo de reembolso',exact:true}).selectOption('partial');
 const input=dialog.getByLabel('Valor a devolver (BRL)',{exact:true});
 for(const value of ['0','1.234,56','1,234','1490,01']){
  await input.fill(value);await dialog.getByRole('checkbox').check();
  await expect(input).toHaveAttribute('aria-invalid','true');
  await expect(dialog.locator('#refund-amount-help')).toContainText('Informe um valor maior que zero');
  await expect(dialog.getByRole('button',{name:'Confirmar operação',exact:true})).toBeDisabled();
 }
 await input.fill('125,50');await expect(input).toHaveAttribute('aria-invalid','false');
 await expect(dialog.getByRole('checkbox')).not.toBeChecked();expect(bodies).toHaveLength(0);
 await dialog.getByRole('checkbox').check();await expect(dialog.getByRole('button',{name:'Confirmar operação',exact:true})).toBeEnabled();
});
test('invoice lookup failures do not appear as an empty payment history',async({page})=>{
 await setup(page,{invoicesUnavailable:true});
 await expect(page.getByText('Não foi possível atualizar as faturas. Tente novamente.',{exact:false})).toBeVisible();
 await expect(page.getByText('Nenhuma fatura',{exact:false})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Reembolsar pagamento',exact:true})).toHaveCount(0);
});
test('back protects an internal note from accidental discard',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Cancelar renovação',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Cancelar renovação',exact:true});
 await dialog.getByLabel('Observação interna (opcional)',{exact:true}).fill('Solicitação em análise');
 await dialog.getByRole('button',{name:'Voltar',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Descartar alterações?',exact:true});await expect(confirmation).toBeVisible();
 await confirmation.getByRole('button',{name:'Continuar editando',exact:true}).click();
 await expect(dialog.getByRole('textbox',{name:'Observação interna (opcional)',exact:true})).toHaveValue('Solicitação em análise');
});
test('changing the received date discards an in-flight refund preview',async({page})=>{
 const bodies=await setup(page);let release;let arrived;
 const started=new Promise(resolve=>{arrived=resolve;});
 await page.route('**/api/admin/billing/operations?*',async route=>{
  const requestedAt=new URL(route.request().url()).searchParams.get('requestedAt');
  await new Promise(resolve=>{release=resolve;arrived();});
  await route.fulfill({json:{invoiceId:invoice.id,currency:'brl',available:149000,annualEligible:false,requestedAt,refunds:[]}});
 });
 await page.getByRole('button',{name:'Reembolsar pagamento',exact:true}).click();await started;
 const dialog=page.getByRole('dialog',{name:'Reembolsar pagamento',exact:true});
 await dialog.getByLabel('Pedido recebido em',{exact:true}).fill('2026-01-01T12:00');
 release();await expect(dialog.getByRole('button',{name:'Recalcular prévia',exact:true})).toBeEnabled();
 await dialog.getByRole('checkbox').check();await expect(dialog.getByRole('button',{name:'Confirmar operação',exact:true})).toBeDisabled();
 await expect(dialog.getByText('Disponível para devolver:',{exact:false})).toHaveCount(0);expect(bodies).toHaveLength(0);
});
