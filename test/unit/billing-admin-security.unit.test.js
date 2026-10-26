import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {ERR} from '../../lib/api-error-codes.js';
import * as permissions from '../../lib/identity/permissions.js';
import * as stripe from '../../lib/billing/stripe.js';

test('financial operations require a platform superadmin and same-origin POSTs',async()=>{
  const previous=process.env.APP_URL;process.env.APP_URL='https://grow-test.example';
  try{
    const context=vm.createContext({console,process});
    const module=new vm.SourceTextModule(await readFile('lib/billing/admin-api.js','utf8'),{context});
    await module.link(path=>{const values=path==='next/server'?{NextResponse:{json:(body,init)=>Response.json(body,init)}}:path.includes('/admin-api.js')?{withAdminApi:(_opts,handler)=>handler}:path.includes('permissions')?permissions:path.includes('api-error')?{ERR,apiError:(_request,code,status)=>Response.json({code},{status})}:stripe;
      return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});
    await module.evaluate();let calls=0;
    const handler=module.namespace.withPlatformBillingApi({},async()=>{calls++;return{ok:true};});
    for(const role of ['hr','direction','admin'])for(const companyOwner of [true,false]){
      const payload={role,companyId:12,companyOwner};
      assert.equal((await handler({payload,request:new Request('https://grow-test.example/api/admin/billing/companies')})).status,403);
      assert.equal(permissions.canAccessDashboardTab(payload,'subscriptions'),false);
    }
    assert.equal(calls,0);
    const payload={role:'admin',companyId:null};
    assert.equal(permissions.canAccessDashboardTab(payload,'subscriptions'),true);
    const send=headers=>handler({payload,request:new Request('https://grow-test.example/api/admin/billing/operations',{method:'POST',headers})});
    assert.equal((await send({})).status,403);
    assert.equal((await send({origin:'https://foreign.example'})).status,403);
    assert.equal(calls,0);
    const response=await send({origin:'https://grow-test.example','sec-fetch-site':'same-origin'});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(calls,1);
  }finally{if(previous==null)delete process.env.APP_URL;else process.env.APP_URL=previous;}
});
