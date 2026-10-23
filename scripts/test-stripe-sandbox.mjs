/** Opt-in provider contract test. Only test keys, synthetic customers and test clocks.
 * Never uses the application database or production Stripe credentials.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Stripe from 'stripe';
import { stripeSandboxEnvironment } from '../lib/billing/sandbox-env.js';
import { STRIPE_API_VERSION, billingAccess } from '../lib/billing/catalog.js';
const secret=JSON.parse(JSON.parse(execFileSync('aws',['secretsmanager','get-secret-value','--secret-id','/homolog/30grow/stripe','--region','us-west-2','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).SecretString);
const env=stripeSandboxEnvironment(secret);Object.assign(process.env,env,{APP_URL:'http://localhost:3000',NEXT_PUBLIC_APP_URL:'http://localhost:3000'});
const stripe=new Stripe(env.STRIPE_SECRET_KEY,{apiVersion:STRIPE_API_VERSION,maxNetworkRetries:1,timeout:15000,telemetry:false});
const runId=randomUUID();const made={};const results=[];
const pass=name=>{results.push(name);console.log('PASS',name);};
const waitClock=async id=>{for(let i=0;i<60;i++){const c=await stripe.testHelpers.testClocks.retrieve(id);if(c.status==='ready')return c;if(c.status==='internal_failure')throw Error('TEST_CLOCK_FAILED');await new Promise(r=>setTimeout(r,1000));}throw Error('TEST_CLOCK_TIMEOUT');};
try{
 const price=await stripe.prices.retrieve(env.STRIPE_PRICE_BRL_SMALL_MONTHLY);assert.equal(price.livemode,false);assert.equal(price.currency,'brl');assert.equal(price.unit_amount,14900);pass('sandbox price contract');
 const metadata={app:'30grow',purpose:'automated_sandbox_contract',run_id:runId};
 made.checkoutCustomer=(await stripe.customers.create({name:'30Grow synthetic checkout test',metadata})).id;
 const {checkoutParams}=await import('../lib/billing/accounts.js');
 made.checkout=(await stripe.checkout.sessions.create(checkoutParams({company_id:999999,customer_id:made.checkoutCustomer,checkout_attempt:runId,checkout_plan_key:'brl_small_monthly',checkout_launch:false,checkout_created_at:new Date().toISOString()},999999))).id;
 const checkout=await stripe.checkout.sessions.retrieve(made.checkout);assert.equal(checkout.livemode,false);assert.equal(checkout.consent_collection.terms_of_service,'required');await stripe.checkout.sessions.expire(made.checkout);pass('application Checkout parameters accepted with mandatory terms');
 const frozen=Math.floor(Date.now()/1000);made.clock=(await stripe.testHelpers.testClocks.create({frozen_time:frozen,name:'30Grow provider contract '+runId})).id;
 made.customer=(await stripe.customers.create({name:'30Grow synthetic billing test',test_clock:made.clock,metadata})).id;
 const good=await stripe.paymentMethods.create({type:'card',card:{token:'tok_visa'}});await stripe.paymentMethods.attach(good.id,{customer:made.customer});
 const bad=await stripe.paymentMethods.create({type:'card',card:{token:'tok_chargeCustomerFail'}});await stripe.paymentMethods.attach(bad.id,{customer:made.customer});
 const sub=await stripe.subscriptions.create({customer:made.customer,items:[{price:price.id}],default_payment_method:good.id,payment_behavior:'error_if_incomplete',metadata});made.subscription=sub.id;
 assert.equal(sub.livemode,false);assert.equal(sub.status,'active');const firstInvoice=await stripe.invoices.retrieve(typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice.id);assert.equal(firstInvoice.status,'paid');pass('subscription creation and first payment');
 const portal=await stripe.billingPortal.sessions.create({customer:made.customer,configuration:env.STRIPE_PORTAL_CONFIGURATION_ID,return_url:'http://localhost:3000/dashboard?tab=profile&section=billing'});assert.equal(new URL(portal.url).hostname,'billing.stripe.com');pass('customer self-service portal');
 await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true});assert.equal((await stripe.subscriptions.retrieve(sub.id)).cancel_at_period_end,true);await stripe.subscriptions.update(sub.id,{cancel_at_period_end:false});pass('cancel renewal and resume without refund');
 await stripe.subscriptions.update(sub.id,{default_payment_method:bad.id});
 const end=sub.items.data[0].current_period_end;assert.ok(end>frozen);await stripe.testHelpers.testClocks.advance(made.clock,{frozen_time:end+3700});await waitClock(made.clock);
 let overdue=await stripe.subscriptions.retrieve(sub.id);
 for(let i=0;i<15&&overdue.status==='active';i++){await new Promise(r=>setTimeout(r,1000));overdue=await stripe.subscriptions.retrieve(sub.id);}
 assert.equal(overdue.status,'past_due');const overdueInvoiceId=typeof overdue.latest_invoice==='string'?overdue.latest_invoice:overdue.latest_invoice.id;
 const overdueInvoice=await stripe.invoices.retrieve(overdueInvoiceId);assert.equal(overdueInvoice.status,'open');assert.equal(billingAccess({managed:true,status:overdue.status,periodEnd:new Date(overdue.items.data[0].current_period_end*1000).toISOString(),knownPlan:true},(end+3700)*1000),false);pass('failed renewal stays unpaid and restricts managed access');
 // Provider-side replacement represents the result of the hosted portal action.
 // It does not certify the portal's browser form; UI navigation is tested separately.
 await stripe.customers.update(made.customer,{invoice_settings:{default_payment_method:good.id}});await stripe.subscriptions.update(sub.id,{default_payment_method:good.id});
 const paid=await stripe.invoices.pay(overdueInvoiceId,{payment_method:good.id});assert.equal(paid.status,'paid');const recovered=await stripe.subscriptions.retrieve(sub.id);assert.equal(recovered.status,'active');pass('replacement card and invoice payment recover the subscription');
 const payments=await stripe.invoicePayments.list({invoice:firstInvoice.id});const payment=payments.data.find(p=>p.status==='paid');assert.ok(payment);
 const intent=await stripe.paymentIntents.retrieve(payment.payment.payment_intent);const charge=typeof intent.latest_charge==='string'?intent.latest_charge:intent.latest_charge.id;
 const refund=await stripe.refunds.create({charge,amount:100,metadata},{idempotencyKey:'30grow:sandbox:'+runId});assert.equal(refund.status,'succeeded');assert.equal((await stripe.charges.retrieve(charge)).livemode,false);
 const replay=await stripe.refunds.create({charge,amount:100,metadata},{idempotencyKey:'30grow:sandbox:'+runId});assert.equal(replay.id,refund.id);pass('partial refund and provider idempotency');
 const remaining=await stripe.refunds.create({charge,amount:firstInvoice.amount_paid-100,metadata});assert.equal(remaining.status,'succeeded');assert.equal((await stripe.charges.retrieve(charge)).amount_refunded,firstInvoice.amount_paid);pass('full remaining refund');
 const canceled=await stripe.subscriptions.cancel(sub.id,{invoice_now:false,prorate:false});assert.equal(canceled.status,'canceled');made.subscription=null;pass('termination without automatic refund or extra invoice');
 console.log(JSON.stringify({sandbox:true,checks:results.length,runId,productionChanged:false,applicationDatabaseUsed:false,browserCheckoutCompleted:false,webhookDeliveryCertified:false}));
}catch(error){console.error('SANDBOX_CONTRACT_FAILED',{type:error.type||error.name,code:error.code||null,requestId:error.requestId||null,param:error.param||null,message:String(error.message||'').replace(/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g,'[redacted]'),assertion:error.code==='ERR_ASSERTION'?error.message:undefined});process.exitCode=1;}
finally{
 try{if(made.subscription)await stripe.subscriptions.cancel(made.subscription,{invoice_now:false,prorate:false});if(made.customer)await stripe.customers.del(made.customer);if(made.checkoutCustomer)await stripe.customers.del(made.checkoutCustomer);if(made.clock){await waitClock(made.clock);await stripe.testHelpers.testClocks.del(made.clock);}console.log('Synthetic sandbox customers and test clock cleaned up');}catch(error){console.error('SANDBOX_CLEANUP_FAILED',{type:error.type||error.name,code:error.code||null});process.exitCode=1;}
}
