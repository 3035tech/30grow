import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Stripe from 'stripe';
import { BILLING_PLANS, fitsPlan, billingAccess, addUtcMonths, canManageBilling } from '../../lib/billing/catalog.js';
import { BillingError, requireSameOrigin, checkedPrice } from '../../lib/billing/stripe.js';
import { CAP, resolveCapabilities } from '../../lib/permissions.js';

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
test('headcount boundaries and approved annual pricing', () => {
  for (const [key, max] of [['brl_small_monthly',20],['brl_growing_monthly',50],['brl_medium_monthly',100],['brl_small_annual',20]]) {
    const plan = BILLING_PLANS.find(p => p.key === key);
    assert.equal(fitsPlan(plan, max), true);
    assert.equal(fitsPlan(plan, max + 1), false);
  }
  assert.equal(BILLING_PLANS.find(p => p.key === 'brl_small_annual').amount,149000);
  assert.equal(canManageBilling({ role:'direction',companyId:1,companyOwner:true }),true);
  assert.equal(canManageBilling({ role:'employee',companyId:1 }),false);
});
test('managed access does not trust redirects, canceled subscriptions or unknown prices', () => {
  assert.equal(billingAccess({ managed:true,trialEndsAt:future,status:'none' }),true);
  assert.equal(billingAccess({ managed:true,trialEndsAt:past,status:'none' }),false);
  for (const status of ['canceled','unpaid','past_due','incomplete','incomplete_expired','paused']) assert.equal(billingAccess({ managed:true,trialEndsAt:future,status,periodEnd:future }),false,status);
  assert.equal(billingAccess({ managed:true,status:'active',periodEnd:future }),true);
  assert.equal(billingAccess({ managed:true,status:'active',periodEnd:future,knownPlan:false }),false);
  assert.equal(billingAccess({ managed:true,status:'active',periodEnd:past }),false);
  assert.equal(billingAccess({ managed:false,status:'none',trialEndsAt:past }),true);
  const restricted = resolveCapabilities({ role:'direction',companyId:1,billingRestricted:true });
  assert.deepEqual([...restricted],[CAP.PROFILE_SELF]);
  assert.ok(resolveCapabilities({ role:'admin',billingRestricted:true }).has(CAP.COMPANIES_MANAGE));
});
test('founder expiry uses twelve calendar months after trial, clamped at month end', () => {
  assert.equal(new Date(addUtcMonths(Date.parse('2024-02-29T12:00:00Z')/1000,12)*1000).toISOString(),'2025-02-28T12:00:00.000Z');
  assert.equal(new Date(addUtcMonths(Date.parse('2026-01-31T12:00:00Z')/1000,1)*1000).toISOString(),'2026-02-28T12:00:00.000Z');
});
test('billing mutations reject cross-site and missing origins', () => {
  const previous = process.env.APP_URL;
  process.env.APP_URL = 'https://grow.example';
  try {
  for (const headers of [{},{origin:'https://evil.example'},{origin:'https://grow.example','sec-fetch-site':'cross-site'}]) assert.throws(() => requireSameOrigin(new Request('https://grow.example/api/admin/billing/checkout',{method:'POST',headers})),BillingError);
  requireSameOrigin(new Request('https://grow.example/api/admin/billing/checkout',{method:'POST',headers:{origin:'https://grow.example','sec-fetch-site':'same-origin'}}));
  } finally { if (previous == null) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});
test('configured Stripe price must match amount, currency and recurring interval',async () => {
  const plan=BILLING_PLANS[0];
  const prior=process.env[plan.env]; process.env[plan.env]='price_test';
  const expected={id:'price_test',active:true,type:'recurring',unit_amount:14900,currency:'brl',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1}};
  try {
    assert.equal((await checkedPrice({prices:{retrieve:async()=>expected}},plan)).id,'price_test');
    for(const patch of [{unit_amount:69},{currency:'usd'},{active:false},{recurring:{interval:'year',interval_count:1}}]) await assert.rejects(checkedPrice({prices:{retrieve:async()=>({...expected,...patch})}},plan),{code:'BILLING_PRICE_INVALID'});
  } finally { if(prior==null)delete process.env[plan.env];else process.env[plan.env]=prior; }
});
test('webhook verifies exact raw bytes, rejects invalid/replayed signatures before processing', async () => {
  const stripe=new Stripe('sk_test_unit');
  let processed=0;
  const env={STRIPE_SECRET_KEY:'sk_test_unit',STRIPE_WEBHOOK_SECRET:'whsec_unit'};
  const context=vm.createContext({console,process:{env},Buffer});
  const source=await readFile(new URL('../../app/api/webhooks/stripe/route.js',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(source,{context});
  await module.link(specifier=>{
    const exports=specifier==='next/server'?{NextResponse:{json:(body,init)=>Response.json(body,init)}}:specifier.includes('/stripe.js')?{getStripe:()=>stripe,BillingError}:{processBillingEvent:async()=>{processed++;return{received:true};}};
    return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});
  });
  await module.evaluate();
  const raw='{ "id":"evt_unit", "livemode":false, "type":"checkout.session.completed", "data":{"object":{}} }';
  const signature=stripe.webhooks.generateTestHeaderString({payload:raw,secret:env.STRIPE_WEBHOOK_SECRET});
  const send=(body,header)=>module.namespace.POST(new Request('https://grow.example/api/webhooks/stripe',{method:'POST',body,headers:{'stripe-signature':header}}));
  assert.equal((await send(raw,signature)).status,200);
  assert.equal((await send(JSON.stringify(JSON.parse(raw)),signature)).status,400);
  assert.equal((await send(raw,'bad')).status,400);
  const expired=stripe.webhooks.generateTestHeaderString({payload:raw,secret:env.STRIPE_WEBHOOK_SECRET,timestamp:1});
  assert.equal((await send(raw,expired)).status,400);
  assert.equal(processed,1);
});

test('only the company owner and platform super-admin manage billing', () => {
  for (const role of ['hr', 'direction', 'admin']) {
    assert.equal(canManageBilling({role,companyId:7}),false,`${role} without ownership`);
    assert.equal(canManageBilling({role,companyId:7,companyOwner:true}),true,`${role} owner`);
    assert.deepEqual([...resolveCapabilities({role,companyId:7,billingRestricted:true})],[CAP.PROFILE_SELF]);
    assert.deepEqual([...resolveCapabilities({role,companyId:7,accessRestricted:true})],[CAP.PROFILE_SELF]);
  }
  assert.equal(canManageBilling({role:'admin',companyId:null}),true);
  for (const role of ['employee','candidate']) assert.equal(canManageBilling({role,companyId:7,companyOwner:true}),false);
  assert.equal(canManageBilling({role:'hr',companyOwner:true}),false);
});
