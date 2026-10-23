import test from 'node:test';
import assert from 'node:assert/strict';
import { stripeSandboxEnvironment } from '../../lib/billing/sandbox-env.js';
test('development refuses live and missing sandbox keys',()=>{
 for(const key of ['',undefined,'sk_live_test','rk_live_test'])assert.throws(()=>stripeSandboxEnvironment({STRIPE_SECRET_KEY:key}),/sandbox key/);
});
test('sandbox settings replace all inherited live billing configuration',()=>{
 const env=stripeSandboxEnvironment({STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_PRICE_BRL_SMALL_MONTHLY:'price_sandbox',environment:'sandbox'}, {STRIPE_SECRET_KEY:'sk_live_old',STRIPE_WEBHOOK_SECRET:'whsec_live',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_live',STRIPE_PRICE_BRL_SMALL_MONTHLY:'price_live',POSTGRES_HOST:'localhost'});
 assert.equal(env.STRIPE_SECRET_KEY,'sk_test_fixture');assert.equal(env.STRIPE_PRICE_BRL_SMALL_MONTHLY,'price_sandbox');assert.equal(env.STRIPE_WEBHOOK_SECRET,undefined);assert.equal(env.STRIPE_PORTAL_CONFIGURATION_ID,undefined);assert.equal(env.STRIPE_BILLING_ENFORCE,'true');assert.equal(env.POSTGRES_HOST,'localhost');
});
