/** Explicit opt-in, isolated Postgres only. No .env and no Stripe network calls.
 * BILLING_TEST_PG_PORT=55447 node --experimental-vm-modules --test test/integration/stripe-billing.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as catalog from '../../lib/billing/catalog.js';
import * as stripeModule from '../../lib/billing/stripe.js';
import * as publicLegal from '../../lib/public-legal.js';
import * as errorCodes from '../../lib/api-error-codes.js';

const port=Number(process.env.BILLING_TEST_PG_PORT);
test('Stripe billing migration, retries, tenant isolation and founder concurrency', {skip: !port}, async t => {
  assert.equal(port,55447,'This test is restricted to the isolated billing test server');
  const schema='billing_'+randomUUID().replaceAll('-','');
  const root=new Pool({host:'127.0.0.1',port,user:'grow_billing_test',database:'postgres',max:2});
  await root.query(`CREATE SCHEMA ${schema}`);
  const pool=new Pool({host:'127.0.0.1',port,user:'grow_billing_test',database:'postgres',options:`-c search_path=${schema} -c grow.billing_mode=test`,max:24});
  const db={query:(...args)=>pool.query(...args),withTransaction:async fn=>{
    const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }};
  const env={...process.env,APP_URL:'https://grow-test.example',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_fixture'};
  for(const plan of [...catalog.BILLING_PLANS,catalog.LAUNCH_PRICE]) env[plan.env]='price_'+plan.key;
  const prices=Object.fromEntries([...catalog.BILLING_PLANS,catalog.LAUNCH_PRICE].map(plan=>[env[plan.env],{id:env[plan.env],product:'prod_fixture',active:true,type:'recurring',billing_scheme:'per_unit',currency:plan.currency,unit_amount:plan.amount,recurring:{interval:plan.interval,interval_count:1}}]));
  const sessions=new Map(),subscriptions=new Map(),schedules=new Map(),idempotency=new Map();
  let createdCustomers=0,createdSessions=0,failSessionOnce=false,failSubscriptionOnce=false,portalParams;
  const stripe={
    prices:{retrieve:async id=>prices[id]},
    customers:{create:async(params,opts)=>{if(!idempotency.has(opts.idempotencyKey))idempotency.set(opts.idempotencyKey,{id:'cus_'+(++createdCustomers)});return idempotency.get(opts.idempotencyKey);}},
    subscriptions:{list:async({customer})=>({data:[...subscriptions.values()].filter(s=>s.customer===customer)}),retrieve:async id=>{if(failSubscriptionOnce){failSubscriptionOnce=false;throw new Error('transient provider failure');}return subscriptions.get(id);},update:async(id,params)=>{Object.assign(subscriptions.get(id),params);return subscriptions.get(id);}},
    checkout:{sessions:{
      retrieve:async id=>sessions.get(id),list:async({customer})=>({data:[...sessions.values()].filter(s=>s.customer===customer)}),
      expire:async id=>{sessions.get(id).status='expired';return sessions.get(id);},
      create:async(params,opts)=>{
        if(!idempotency.has(opts.idempotencyKey)){
          const id='cs_test_'+(++createdSessions);
          const session={id,status:'open',livemode:false,mode:'subscription',url:'https://checkout.stripe.com/'+id,customer:params.customer,client_reference_id:params.client_reference_id,expires_at:params.expires_at,metadata:params.metadata,params};
          sessions.set(id,session);idempotency.set(opts.idempotencyKey,session);
        }
        if(failSessionOnce){failSessionOnce=false;throw new Error('response lost after creation');}
        return idempotency.get(opts.idempotencyKey);
      }
    }},
    subscriptionSchedules:{
      create:async({from_subscription},opts)=>{if(!idempotency.has(opts.idempotencyKey)){
        const sub=subscriptions.get(from_subscription);const schedule={id:'sched_'+sub.id,status:'active',metadata:{},current_phase:{start_date:sub.start_date},phases:[{start_date:sub.start_date}]};schedules.set(schedule.id,schedule);sub.schedule=schedule.id;idempotency.set(opts.idempotencyKey,schedule);
      }return idempotency.get(opts.idempotencyKey);},
      retrieve:async id=>schedules.get(id),update:async(id,params)=>{const schedule=schedules.get(id);Object.assign(schedule,params);const sub=[...subscriptions.values()].find(s=>s.schedule===id);if(sub&&params.phases)sub.cancel_at=params.end_behavior==='cancel'?params.phases[0].end_date:null;return schedule;},release:async id=>{const sub=[...subscriptions.values()].find(s=>s.schedule===id);sub.schedule=null;sub.cancel_at=null;return schedules.get(id);}
    },
    invoices:{list:async()=>({data:[]})},
    billingPortal:{configurations:{create:async params=>{portalParams=params;return{id:'bpc_target'};}},sessions:{create:async params=>{portalParams={...portalParams,session:params};return{url:'https://billing.stripe.com/test'};}}}
  };
  const invoices=new Map(),payments=new Map(),charges=new Map(),intents=new Map(),refunds=new Map();
  let refundCalls=0,loseRefundResponse=false,denyRefund=false,loseCancellationResponse=false;
  stripe.invoices.retrieve=async id=>invoices.get(id);
  stripe.invoicePayments={list:async({invoice})=>({data:payments.get(invoice)||[],has_more:false})};
  stripe.charges={retrieve:async id=>charges.get(id)};
  stripe.paymentIntents={retrieve:async id=>intents.get(id)};
  stripe.refunds={list:({charge})=>({async *[Symbol.asyncIterator](){for(const r of refunds.values())if(r.charge===charge)yield r;}}),retrieve:async id=>refunds.get(id),create:async(params,opts)=>{
    refundCalls++;
    if(denyRefund){const e=new Error('permission denied');e.type='StripePermissionError';throw e;}
    let r=idempotency.get(opts.idempotencyKey);
    if(!r){r={id:'re_fixture_'+refundCalls,charge:params.charge,amount:params.amount,currency:charges.get(params.charge).currency,status:'pending',created:Math.floor(Date.now()/1000),metadata:params.metadata};refunds.set(r.id,r);idempotency.set(opts.idempotencyKey,r);}
    if(loseRefundResponse){loseRefundResponse=false;const e=new Error('lost response');e.type='StripeConnectionError';throw e;}
    return r;
  }};
  const updateSubscription=stripe.subscriptions.update;
  stripe.subscriptions.update=async(...args)=>{const result=await updateSubscription(...args);if(loseCancellationResponse){loseCancellationResponse=false;throw new Error('lost cancellation response');}return result;};
  stripe.subscriptions.cancel=async(id,params)=>{assert.equal(params.invoice_now,false);assert.equal(params.prorate,false);subscriptions.get(id).status='canceled';return subscriptions.get(id);};
  stripe.subscriptionSchedules.cancel=async(id,params)=>{assert.equal(params.invoice_now,false);assert.equal(params.prorate,false);const schedule=schedules.get(id);schedule.status='canceled';[...subscriptions.values()].find(x=>x.schedule===id).status='canceled';return schedule;};
  const fakeStripe={...stripeModule,getStripe:()=>stripe,stripeMode:()=>false,billingBaseUrl:()=>env.APP_URL,
    checkedPrice:async(_stripe,plan)=>{const value=prices[env[plan.env]];if(!value||value.unit_amount!==plan.amount)throw new stripeModule.BillingError('BILLING_PRICE_INVALID',503);return value;}};
  const fakeCatalog={...catalog,priceId:plan=>env[plan.env]||'',planForPrice:id=>[...catalog.BILLING_PLANS,catalog.LAUNCH_PRICE].find(plan=>env[plan.env]===id)||null};
  let syncApi,refundApi;
  async function load(file){
    const context=vm.createContext({console,process:{env},Date,Buffer,URL,Math,Number,Set,Map});
    const module=new vm.SourceTextModule(await readFile(new URL('../../'+file,import.meta.url),'utf8'),{context});
    await module.link(specifier=>{
      const exports=specifier==='node:crypto'?{randomUUID}:specifier.includes('api-error-codes.js')?errorCodes:specifier.includes('public-legal.js')?publicLegal:specifier.includes('db.js')?db:specifier.includes('catalog.js')?fakeCatalog:specifier.includes('stripe.js')?fakeStripe:specifier.includes('refunds.js')?refundApi:specifier.includes('license.js')?{loadCompanyLicense:async()=>null}:specifier.includes('sync.js')?syncApi:null;
      if(!exports)throw new Error('Unexpected dependency '+specifier);
      return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v);},{context});
    });await module.evaluate();return module.namespace;
  }
  async function company({employees=0}={}){
    const id=(await db.query("INSERT INTO companies(name) VALUES('Billing fixture') RETURNING id")).rows[0].id;
    const userId=(await db.query("INSERT INTO users(company_id,email,signup_source) VALUES($1,$2,'early_access') RETURNING id",[id,`billing-${id}@example.test`])).rows[0].id;
    for(let i=0;i<employees;i++)await db.query("INSERT INTO candidates(company_id,employment_status) VALUES($1,'employee')",[id]);
    return{companyId:id,userId};
  }
  function complete(sessionId,{status='trialing',unknownPrice=false}={}){
    const session=sessions.get(sessionId);session.status='complete';session.subscription='sub_'+sessionId;
    const now=Math.floor(Date.now()/1000),price=prices[session.params.line_items[0].price];
    const sub={id:session.subscription,customer:session.customer,livemode:false,status,currency:price.currency,start_date:now,trial_end:session.params.subscription_data.trial_end||null,metadata:session.metadata,items:{data:[{id:'si_'+sessionId,quantity:1,price:unknownPrice?{...price,id:'price_foreign'}:price,current_period_end:now+2592000}]},cancel_at_period_end:false,schedule:null};
    subscriptions.set(sub.id,sub);return sub;
  }
  const event=(sub,type='customer.subscription.updated',id='evt_'+randomUUID())=>({id,type,livemode:false,created:Math.floor(Date.now()/1000),data:{object:sub}});
  try{
    await db.query(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY);CREATE TABLE companies(id SERIAL PRIMARY KEY,name TEXT NOT NULL,active BOOLEAN DEFAULT TRUE,deleted BOOLEAN DEFAULT FALSE);CREATE TABLE users(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id),email TEXT,signup_source TEXT,created_at TIMESTAMPTZ DEFAULT now());CREATE TABLE candidates(id SERIAL PRIMARY KEY,company_id INTEGER REFERENCES companies(id),employment_status TEXT);ALTER TABLE companies ADD COLUMN signup_creator_user_id INTEGER REFERENCES users(id);`);
    for(const file of ['122_company_early_access_license.sql','125_company_trial_terms.sql'])await db.query(await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8'));
    const legacy=await company();
    const before=(await db.query('SELECT * FROM company_licenses WHERE company_id=$1',[legacy.companyId])).rows[0];
    const migration=await readFile(new URL('../../migrations/166_stripe_billing.sql',import.meta.url),'utf8');
    await db.query(migration);
    const fresh=await company();
    await db.query(migration);
    await t.test('migration retries preserve old licenses and give new companies 30 days',async()=>{
      assert.deepEqual((await db.query('SELECT * FROM company_licenses WHERE company_id=$1',[legacy.companyId])).rows[0],before);
      assert.equal((await db.query('SELECT managed FROM company_billing_terms WHERE company_id=$1',[legacy.companyId])).rows[0].managed,false);
      assert.equal((await db.query('SELECT trial_days FROM company_licenses WHERE company_id=$1',[fresh.companyId])).rows[0].trial_days,30);
      assert.equal((await db.query('SELECT managed FROM company_billing_terms WHERE company_id=$1',[fresh.companyId])).rows[0].managed,true);
      await assert.rejects(db.query("INSERT INTO company_billing_accounts(company_id,livemode,status) VALUES($1,FALSE,'fake')",[fresh.companyId]),{code:'23514'});
    });
    const operationMigration=await readFile(new URL('../../migrations/169_billing_admin_operations.sql',import.meta.url),'utf8');
    await db.query(operationMigration);await db.query(operationMigration);
    refundApi=await load('lib/billing/refunds.js');
    const sync=syncApi=await load('lib/billing/sync.js'),accounts=await load('lib/billing/accounts.js');
    await t.test('lost Stripe responses and repeated clicks reuse a durable checkout',async()=>{
      failSessionOnce=true;
      await assert.rejects(accounts.startCheckout({...fresh,planKey:'brl_small_monthly'}),/response lost/);
      const result=await accounts.startCheckout({...fresh,planKey:'brl_small_monthly'});
      const again=await accounts.startCheckout({...fresh,planKey:'brl_small_monthly'});
      assert.equal(result.url,again.url);assert.equal(createdCustomers,1);assert.equal(createdSessions,1);
      assert.ok([...sessions.values()][0].params.subscription_data.trial_end>Math.floor(Date.now()/1000));
      const params = [...sessions.values()][0].params;
      assert.equal(params.consent_collection.terms_of_service, 'required');
      assert.equal(params.metadata.terms_version, publicLegal.PUBLIC_TERMS_VERSION);
      assert.equal(params.metadata.initiated_by_user_id, String(fresh.userId));
      assert.match(params.custom_text.terms_of_service_acceptance.message, /terms#cancelamento-e-reembolso/);
      await assert.rejects(sync.confirmCheckout(legacy.companyId,'cs_test_1'),{code:'NOT_FOUND'});
    });
    await t.test('hosted acceptance matches the Brazilian or international offer',async()=>{
      const account={company_id:fresh.companyId,customer_id:'cus_fixture',checkout_created_at:new Date().toISOString()};
      for (const [planKey,pattern] of [['brl_small_monthly',/Li e aceito/],['usd_company_monthly',/I agree to the/]]) {
        const params=accounts.checkoutParams({...account,checkout_plan_key:planKey},fresh.userId);
        assert.equal(params.consent_collection.terms_of_service,'required');
        assert.equal(params.metadata.terms_version,publicLegal.PUBLIC_TERMS_VERSION);
        assert.match(params.custom_text.terms_of_service_acceptance.message,pattern);
        assert.match(params.custom_text.terms_of_service_acceptance.message,/terms#cancelamento-e-reembolso/);
      }
    });
    const firstSub=complete('cs_test_1');
    await t.test('callback verifies ownership; webhook reconciliation is idempotent and order independent',async()=>{
      await sync.confirmCheckout(fresh.companyId,'cs_test_1');
      const delivered=event({...firstSub,status:'canceled'});
      await Promise.all([sync.processBillingEvent(delivered),sync.processBillingEvent(delivered)]);
      assert.equal((await db.query('SELECT status FROM company_billing_accounts WHERE company_id=$1',[fresh.companyId])).rows[0].status,'trialing');
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_webhook_events WHERE event_id=$1',[delivered.id])).rows[0].n,1);
      firstSub.status='canceled';
      await sync.processBillingEvent(event({...firstSub,status:'active'}));
      assert.equal((await db.query('SELECT status FROM company_billing_accounts WHERE company_id=$1',[fresh.companyId])).rows[0].status,'canceled');
      const retryEvent=event(firstSub);failSubscriptionOnce=true;
      await assert.rejects(sync.processBillingEvent(retryEvent),/transient/);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_webhook_events WHERE event_id=$1',[retryEvent.id])).rows[0].n,0);
      await sync.processBillingEvent(retryEvent);
      await assert.rejects(sync.processBillingEvent({...retryEvent,id:'evt_live',livemode:true}),{code:'BILLING_MODE_MISMATCH'});
    });
    await t.test('billing refresh reconciles a missed renewal webhook',async()=>{
      firstSub.status='active';
      firstSub.items.data[0].current_period_end+=2592000;
      const summary=await accounts.billingSummary(fresh.companyId,'brl');
      assert.equal(summary.status,'active');
      assert.equal(new Date(summary.periodEnd).getTime()/1000,firstSub.items.data[0].current_period_end);
    });
    await t.test('headcount checks reject under-sized plans and portal config exposes only a validated target',async()=>{
      const medium=await company({employees:21});
      await assert.rejects(accounts.startCheckout({...medium,planKey:'brl_small_monthly'}),{code:'BILLING_CAPACITY'});
      await accounts.startCheckout({...medium,planKey:'brl_growing_monthly'});
      const session=[...sessions.values()].find(s=>s.client_reference_id===String(medium.companyId));
      complete(session.id,{status:'active'});await sync.confirmCheckout(medium.companyId,session.id);
      await assert.rejects(accounts.openBillingPortal(medium.companyId,'brl_small_monthly'),{code:'BILLING_CAPACITY'});
      await accounts.openBillingPortal(medium.companyId,'brl_medium_monthly');
      assert.equal(portalParams.features.subscription_update.products[0].prices[0],'price_brl_medium_monthly');
      assert.equal(portalParams.session.flow_data.subscription_update_confirm.items[0].quantity,1);
      await assert.rejects(accounts.startCheckout({...medium,planKey:'brl_growing_monthly'}),{code:'BILLING_SUBSCRIPTION_EXISTS'});
    });
    let founders=[];
    await t.test('21 concurrent founder checkouts reserve exactly 20 slots',async()=>{
      founders=await Promise.all(Array.from({length:21},()=>company()));
      const results=await Promise.allSettled(founders.map(c=>accounts.startCheckout({...c,planKey:'brl_small_monthly',launch:true})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,20);
      assert.equal(results.find(r=>r.status==='rejected').reason.code,'BILLING_LAUNCH_UNAVAILABLE');
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_launch_redemptions WHERE livemode=FALSE')).rows[0].n,20);
      await assert.rejects(accounts.startCheckout({...founders[0],planKey:'brl_small_annual',launch:true}),{code:'BILLING_PLAN_INVALID'});
    });
    await t.test('founder schedule switches to 149 after twelve paid months, after the remaining free trial',async()=>{
      const session=[...sessions.values()].find(s=>s.metadata.launch==='true');
      const sub=complete(session.id);
      await sync.confirmCheckout(Number(session.client_reference_id),session.id);
      const schedule=schedules.get(sub.schedule);
      assert.equal(schedule.phases[0].end_date,catalog.addUtcMonths(sub.trial_end,12));
      assert.equal(schedule.phases[0].items[0].price,'price_brl_launch_monthly');
      assert.equal(schedule.phases[1].items[0].price,'price_brl_small_monthly');
      assert.equal(schedule.end_behavior,'release');
      await sync.processBillingEvent(event(sub));
      assert.equal(schedules.size,1,'duplicate events do not create new schedules');
      assert.equal((await db.query('SELECT redeemed FROM billing_launch_redemptions WHERE company_id=$1',[Number(session.client_reference_id)])).rows[0].redeemed,true);
    });
    await t.test('founders can cancel at period end and resume without losing their scheduled regular price',async()=>{
      const sub=[...subscriptions.values()].find(s=>s.schedule);
      const cid=Number(sub.metadata.company_id);
      await sync.setSubscriptionCancellation(cid,true);
      let schedule=schedules.get(sub.schedule);
      assert.equal(schedule.end_behavior,'cancel');assert.equal(schedule.phases.length,1);
      assert.equal((await db.query('SELECT cancel_at_period_end FROM company_billing_accounts WHERE company_id=$1',[cid])).rows[0].cancel_at_period_end,true);
      await sync.setSubscriptionCancellation(cid,false);
      schedule=schedules.get(sub.schedule);
      assert.equal(schedule.end_behavior,'release');assert.equal(schedule.phases[1].items[0].price,'price_brl_small_monthly');
      assert.equal((await db.query('SELECT cancel_at_period_end FROM company_billing_accounts WHERE company_id=$1',[cid])).rows[0].cancel_at_period_end,false);
    });
    await t.test('expired founder reservations do not reclaim completed payments with delayed webhooks',async()=>{
      const held=[...sessions.values()].find(s=>s.metadata.launch==='true'&&s.status==='open');
      complete(held.id); // payment completed; webhook has not arrived
      await db.query("UPDATE billing_launch_redemptions SET expires_at=now()-interval '1 day' WHERE company_id=$1",[Number(held.client_reference_id)]);
      const extra=await company();
      await assert.rejects(accounts.startCheckout({...extra,planKey:'brl_small_monthly',launch:true}),{code:'BILLING_LAUNCH_UNAVAILABLE'});
      // transaction rolls back on sold-out response; slot remains reserved and cannot be oversold
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM billing_launch_redemptions')).rows[0].n,20);
    });
    await t.test('concurrent hires cannot exceed the purchased employee band',async()=>{
      const bounded=await company();await accounts.startCheckout({...bounded,planKey:'brl_small_monthly'});
      const session=[...sessions.values()].find(s=>s.client_reference_id===String(bounded.companyId));
      complete(session.id,{status:'active'});await sync.confirmCheckout(bounded.companyId,session.id);
      const outcomes=await Promise.allSettled(Array.from({length:21},()=>db.query("INSERT INTO candidates(company_id,employment_status) VALUES($1,'employee')",[bounded.companyId])));
      assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,20);
      assert.equal(outcomes.find(r=>r.status==='rejected').reason.message,'BILLING_CAPACITY');
      await db.query("INSERT INTO candidates(company_id,employment_status) VALUES($1,'candidate')",[bounded.companyId]);
    });
    await t.test('unknown Stripe prices do not activate a managed license',async()=>{
      const foreign=await company();await accounts.startCheckout({...foreign,planKey:'brl_small_monthly'});
      const session=[...sessions.values()].find(s=>s.client_reference_id===String(foreign.companyId));
      complete(session.id,{status:'active',unknownPrice:true});await sync.confirmCheckout(foreign.companyId,session.id);
      const row=(await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1',[foreign.companyId])).rows[0];
      assert.equal(row.plan_key,null);
      assert.equal(catalog.billingAccess({managed:true,status:row.status,periodEnd:row.period_end,knownPlan:Boolean(row.plan_key)}),false);
    });
    await t.test('admin refunds recover provider timeouts, prevent duplicate money movement and preserve licenses',async()=>{
      const admin=await load('lib/billing/admin.js');
      const tenant=await company();await accounts.startCheckout({...tenant,planKey:'brl_small_annual'});
      const session=[...sessions.values()].find(x=>x.client_reference_id===String(tenant.companyId));
      const sub=complete(session.id,{status:'active'});await sync.confirmCheckout(tenant.companyId,session.id);
      const now=Math.floor(Date.now()/1000),start=now-180*86400,end=now+185*86400;
      const invoice={id:'in_admin_fixture',number:'INV-1',customer:session.customer,livemode:false,status:'paid',amount_paid:149000,currency:'brl',created:start,billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:sub.id}},lines:{data:[{pricing:{price_details:{price:'price_brl_small_annual'}},period:{start,end}}],has_more:false}};
      invoices.set(invoice.id,invoice);
      charges.set('ch_admin_fixture',{id:'ch_admin_fixture',customer:session.customer,livemode:false,paid:true,captured:true,amount:149000,currency:'brl'});
      intents.set('pi_admin_fixture',{id:'pi_admin_fixture',customer:session.customer,livemode:false,latest_charge:'ch_admin_fixture'});
      payments.set(invoice.id,[{id:'inpay_fixture',amount_paid:149000,payment:{type:'payment_intent',payment_intent:'pi_admin_fixture'}}]);
      const account=(await db.query('SELECT * FROM company_billing_accounts WHERE company_id=$1',[tenant.companyId])).rows[0];
      const preview=await refundApi.refundPreview(db,stripe,account,invoice.id);
      assert.equal(preview.available,149000);assert.ok(preview.proportional>70000&&preview.proportional<80000);
      await assert.rejects(refundApi.refundPreview(db,stripe,{...account,customer_id:'cus_foreign'},invoice.id),{code:'NOT_FOUND'});
      const input={companyId:tenant.companyId,actorUserId:tenant.userId,requestId:randomUUID(),invoiceId:invoice.id,basis:'partial',amount:1234,reason:'customer_request',note:'Test only'};
      await assert.rejects(refundApi.prepareRefund({...input,requestId:randomUUID(),basis:'full',amount:149001}),{code:'BILLING_REFUND_AMOUNT'});
      const op=await refundApi.prepareRefund(input);loseRefundResponse=true;
      await assert.rejects(refundApi.executeRefund(op.id),{code:'BILLING_OPERATION_PENDING'});
      assert.equal((await db.query('SELECT status FROM billing_admin_operations WHERE id=$1',[op.id])).rows[0].status,'processing');
      await assert.rejects(refundApi.prepareRefund({...input,amount:1500}),{code:'BILLING_OPERATION_CONFLICT'});
      const recovered=await Promise.all([refundApi.executeRefund(op.id),refundApi.executeRefund(op.id)]);
      assert.equal(recovered[0].status,'pending');assert.equal(refundCalls,1);
      const refund=refunds.get(recovered[0].stripe_refund_id);refund.status='succeeded';
      const delivered=event(refund,'refund.updated');await sync.processBillingEvent(delivered);await sync.processBillingEvent(delivered);
      assert.equal((await db.query('SELECT status FROM billing_admin_operations WHERE id=$1',[op.id])).rows[0].status,'succeeded');
      const rejected=await refundApi.prepareRefund({...input,requestId:randomUUID(),amount:500});denyRefund=true;
      await assert.rejects(refundApi.executeRefund(rejected.id),{code:'BILLING_REFUND_REJECTED'});denyRefund=false;
      assert.equal((await db.query('SELECT status FROM billing_admin_operations WHERE id=$1',[rejected.id])).rows[0].status,'failed');
      const stale=await refundApi.prepareRefund({...input,requestId:randomUUID(),amount:500});await db.query("UPDATE billing_admin_operations SET created_at=now()-interval '24 hours' WHERE id=$1",[stale.id]);
      assert.equal((await refundApi.executeRefund(stale.id)).status,'needs_review');
      const annualPreview=await refundApi.refundPreview(db,stripe,account,invoice.id);
      const annual=await refundApi.prepareRefund({...input,requestId:randomUUID(),basis:'annual',amount:annualPreview.proportional,requestedAt:annualPreview.requestedAt,reason:'annual_early_termination'});
      assert.ok(annual.amount>70000&&annual.amount<80000);await refundApi.executeRefund(annual.id);
      await assert.rejects(refundApi.prepareRefund({...input,requestId:randomUUID(),basis:'annual',reason:'annual_early_termination'}));
      const beforeCalls=refundCalls;
      const cancelInput={companyId:tenant.companyId,actorUserId:tenant.userId,requestId:randomUUID(),kind:'cancel_renewal',reason:'customer_request',note:''};
      await admin.performBillingOperation(cancelInput);await admin.performBillingOperation(cancelInput);assert.equal(sub.cancel_at_period_end,true);
      await admin.performBillingOperation({...cancelInput,requestId:randomUUID(),kind:'resume_renewal'});assert.equal(sub.cancel_at_period_end,false);
      const uncertain={...cancelInput,requestId:randomUUID()};loseCancellationResponse=true;
      await assert.rejects(admin.performBillingOperation(uncertain),{code:'BILLING_OPERATION_PENDING'});
      await sync.setSubscriptionCancellation(tenant.companyId,false); // a later owner decision
      await db.query("UPDATE billing_admin_operations SET updated_at=now()-interval '2 minutes' WHERE id=$1",[uncertain.requestId]);
      assert.equal((await admin.performBillingOperation(uncertain)).status,'needs_review');
      assert.equal(sub.cancel_at_period_end,false,'uncertain old cancellation must not override a newer owner decision');
      const license=(await db.query('SELECT * FROM company_licenses WHERE company_id=$1',[tenant.companyId])).rows[0];
      await admin.performBillingOperation({...cancelInput,requestId:randomUUID(),kind:'terminate'});assert.equal(sub.status,'canceled');assert.equal(refundCalls,beforeCalls);
      assert.deepEqual((await db.query('SELECT * FROM company_licenses WHERE company_id=$1',[tenant.companyId])).rows[0],license);
      const journalBefore=(await db.query('SELECT count(*)::int AS n FROM billing_admin_operation_events')).rows[0].n;
      await db.query(operationMigration);assert.equal((await db.query('SELECT count(*)::int AS n FROM billing_admin_operation_events')).rows[0].n,journalBefore);
      const countsSql='SELECT (SELECT count(*) FROM company_licenses) AS licenses,(SELECT count(*) FROM company_billing_accounts) AS accounts';
      const before=(await db.query(countsSql)).rows[0];const customersBefore=createdCustomers;
      const listing=await admin.listBillingCompanies({q:'Billing',page:1,pageSize:20});assert.ok(listing.total>0);
      const details=await admin.billingCompanyDetails(tenant.companyId);assert.ok(details.history.length>0);
      assert.deepEqual((await db.query(countsSql)).rows[0],before);assert.equal(createdCustomers,customersBefore);
      const remaining=await refundApi.refundPreview(db,stripe,account,invoice.id);assert.equal(remaining.available,149000-1234-500-annual.amount);
      const full=await refundApi.prepareRefund({...input,requestId:randomUUID(),basis:'full',amount:remaining.available});await refundApi.executeRefund(full.id);
      assert.equal((await refundApi.refundPreview(db,stripe,account,invoice.id)).available,0);
    });
  }finally{await pool.end();await root.query(`DROP SCHEMA ${schema} CASCADE`);await root.end();}
});
