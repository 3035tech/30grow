import { test, expect } from '@playwright/test';
import { companyLicenseSummary } from '../../lib/company-license.js';
import { BILLING_PLANS } from '../../lib/billing/catalog.js';

function fixture(patch={}) {
  const billing={managed:true,trialEndsAt:'2025-02-01T00:00:00Z',subscriptionId:'sub_fixture',status:'active',planKey:'brl_small_monthly',periodEnd:'2028-01-01T00:00:00Z',cancelAtPeriodEnd:false,livemode:false,...patch};
  return{configured:true,employeeCount:18,currency:'brl',access:true,scheduled:false,launchAvailable:false,canOpenPortal:true,invoices:[],plans:BILLING_PLANS.filter(p=>p.currency==='brl').map(p=>({...p,eligible:true})),...billing,...patch,license:companyLicenseSummary({licenseNumber:'7',licenseStartsAt:'2025-01-01T00:00:00Z',licenseExpiresAt:'2025-02-01T00:00:00Z',licenseExpired:true,licenseOfferTier:'trial',licenseTrialDays:30},billing)};
}
for(const width of [1440,390]) test(`paid subscription updates existing profile license at ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:1000});
 await page.route('**/api/admin/billing?*',route=>route.fulfill({json:fixture()}));
 await page.goto('/billing');
 await expect(page.getByText('30T-EA-000007',{exact:true})).toBeVisible();
 await expect(page.getByText('Licença vinculada à assinatura do 30Grow')).toBeVisible();
 await expect(page.getByText('Período atual até',{exact:true})).toBeVisible();
 await expect(page.getByText('O período gratuito venceu.',{exact:false})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Gerenciar assinatura e cartão'})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Ver assinatura',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Alterar plano no Stripe'})).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:testInfo.outputPath(`billing-profile-${width}.png`),fullPage:true});
});
test('checkout submits company, approved plan and launch selection; no card data enters Grow',async({page})=>{
 await page.route('**/api/admin/billing?*',route=>route.fulfill({json:fixture({subscriptionId:null,status:'none',planKey:null,trialEndsAt:'2028-01-01T00:00:00Z',launchAvailable:true,canOpenPortal:false})}));
 let body;
 await page.route('**/api/admin/billing/checkout',async route=>{body=route.request().postDataJSON();await route.fulfill({json:{url:'https://checkout.stripe.com/grow-ui-test'}});});
 await page.route('https://checkout.stripe.com/grow-ui-test',route=>route.fulfill({contentType:'text/html',body:'<h1>Checkout de teste</h1>'}));
 await page.goto('/billing');
 await page.getByRole('checkbox').check();
 await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Até 20 colaboradores',exact:true})}).filter({hasText:'por mês'}).getByRole('button',{name:'Assinar plano'}).click();
 await expect(page.getByRole('heading',{name:'Checkout de teste'})).toBeVisible();
 expect(body).toEqual({companyId:7,planKey:'brl_small_monthly',launch:true});
});
test('return page waits for server verification instead of trusting the redirect',async({page})=>{
 let calls=0,ready=false;
 await page.route('**/api/admin/billing/confirm',route=>{calls++;return route.fulfill({json:{pending:!ready,status:ready?'active':'incomplete'}});});
 await page.goto('/billing-return');
 await expect(page.getByText('A confirmação ainda está pendente.',{exact:false})).toBeVisible();
 ready=true;
 await page.getByRole('button',{name:'Atualizar',exact:true}).click();
 await expect(page.getByText('Assinatura confirmada.',{exact:false})).toBeVisible();
 expect(calls).toBeGreaterThanOrEqual(2);
});

test('scheduled subscription cancellation requires confirmation and refreshes the profile license',async({page})=>{
 let canceled=false,cancelBody;
 await page.route('**/api/admin/billing?*',route=>route.fulfill({json:fixture({scheduled:true,cancelAtPeriodEnd:canceled})}));
 await page.route('**/api/admin/billing/cancel',route=>{cancelBody=route.request().postDataJSON();canceled=cancelBody.cancel;return route.fulfill({json:{ok:true}});});
 await page.goto('/billing');
 await page.getByRole('button',{name:'Cancelar no fim do período',exact:true}).click();
 expect(cancelBody).toBeUndefined();
 await expect(page.getByText('não haverá novas renovações',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Confirmar cancelamento',exact:true}).click();
 await expect(page.getByRole('button',{name:'Manter assinatura ativa',exact:true})).toBeVisible();
 expect(cancelBody).toEqual({companyId:7,cancel:true,confirmed:true});
 await page.getByRole('button',{name:'Manter assinatura ativa',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cancelar no fim do período',exact:true})).toBeVisible();
 expect(cancelBody.cancel).toBe(false);
});

for(const status of ['past_due','unpaid','incomplete']) test(`owner can recover a ${status} payment through the Stripe portal`,async({page})=>{
 let body;
 await page.route('**/api/admin/billing?*',route=>route.fulfill({json:fixture({status,access:false,invoices:[{id:'in_open',number:'INV-ABERTA',status:'open',currency:'brl',amount:14900,createdAt:'2026-01-01T00:00:00Z',url:'https://invoice.stripe.com/test-open'}]})}));
 await page.route('**/api/admin/billing/portal',route=>{body=route.request().postDataJSON();return route.fulfill({json:{url:'https://billing.stripe.com/test-recovery'}});});
 await page.route('https://billing.stripe.com/test-recovery',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Portal de regularização de teste</h1>'}));
 await page.goto('/billing');await expect(page.getByRole('link',{name:'Pagar fatura',exact:true})).toHaveAttribute('href','https://invoice.stripe.com/test-open');
 await page.getByRole('button',{name:'Atualizar cartão ou pagar fatura',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Portal de regularização de teste',exact:true})).toBeVisible();expect(body).toEqual({companyId:7});
});
