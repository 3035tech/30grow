import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {canManageBilling} from '../../lib/billing/catalog.js';

async function routeFor(payload) {
  let reads=0;
  const deps={
    canManageBilling,
    NextResponse:{json:Response.json}, cookies:async()=>({get:()=>({value:'session'})}),
    COOKIE_NAME:'session',MAX_AGE:123,LOCALE_COOKIE:'locale',SUPPORT_CONTACT_EMAIL:'support@example.test',
    verifySessionWithCapabilities:async()=>payload,
    query:async(_sql,params)=>{
      assert.deepEqual([...params],[payload.userId]);
      return {rowCount:1,rows:[{id:payload.userId,role:payload.role,companyId:payload.companyId,
        email:'owner@example.test',licenseNumber:'private-number',licenseStartsAt:'private-start',licenseExpiresAt:'private-end',licenseExpired:false,licenseOfferTier:'private-tier',licenseTrialDays:777}]};
    },
    licenseWithBilling:async()=>{reads++;return {number:'private-number',expiresAt:'private-end'};},
    apiError:(_req,code,status)=>Response.json({errorCode:code},{status}), ERR:{UNAUTHORIZED:'UNAUTHORIZED',USER_NOT_FOUND:'USER_NOT_FOUND'},
  };
  for (const name of ['hashPassword','signToken','verifyPassword','sessionCookieOptions','normalizeLocale','httpStatusForError','bumpSessionVersion','checkRateLimit','clientIpFromRequest','roleMayUse2Fa','verifyTotpCode','auditFromRequest','enqueueTransactionalMail','isMailConfigured','buildManagerEmailChangedMail']) deps[name]=()=>{throw Error('unexpected '+name);};
  const context=vm.createContext({console});
  const module=new vm.SourceTextModule(await readFile('app/api/me/route.js','utf8'),{context});
  await module.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value] of Object.entries(deps))this.setExport(key,value);},{context}));
  await module.evaluate();
  return {get:()=>module.namespace.GET(new Request('https://grow.example/api/me?companyId=999')),reads:()=>reads};
}

test('non-owners cannot recover license details through profile fields or URL overrides',async()=>{
  for (const role of ['hr','direction','admin']) {
    const route=await routeFor({userId:1,role,companyId:7});
    const response=await route.get(),body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.license,null);
    assert.equal(body.user.canManageBilling,false);
    assert.equal(route.reads(),0);
    assert.ok(!JSON.stringify(body).includes('private-'));
    assert.ok(!Object.keys(body.user).some(key=>key.startsWith('license')));
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
});

test('owner sees the effective subscription license in their own profile',async()=>{
  const route=await routeFor({userId:2,role:'direction',companyId:7,companyOwner:true});
  const body=await (await route.get()).json();
  assert.equal(body.user.canManageBilling,true);
  assert.equal(body.license.expiresAt,'private-end');
  assert.equal(route.reads(),1);
  assert.ok(!Object.keys(body.user).some(key=>key.startsWith('license')));
});
