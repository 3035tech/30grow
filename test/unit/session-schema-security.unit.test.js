import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function fixture({ row, queryError, overrideError, environment='production' }={}) {
  let queries=0;
  const deps={
    query:async()=>{queries++;if(queryError)throw queryError;return {rowCount:row?1:0,rows:row?[row]:[]};},
    verifyToken:()=>({userId:1,sv:3}), normalizeEnabledModules:value=>value,
    setSessionVersionCache:async()=>{}, loadUserCapabilityOverrides:async()=>{if(overrideError)throw overrideError;return [];},
  };
  const context=vm.createContext({process:{env:{NODE_ENV:environment,STRIPE_BILLING_ENFORCE:'false'}}});
  const dependency=()=>{const m=new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context});return m;};
  const mod=new vm.SourceTextModule(await readFile(new URL('../../lib/session.js',import.meta.url),'utf8'),{context,importModuleDynamically:async()=>{const m=dependency();await m.link(()=>{});await m.evaluate();return m;}});
  await mod.link(dependency);await mod.evaluate();return {hydrate:mod.namespace.hydrateSessionPayload,queries:()=>queries};
}
const live={active:true,userDeleted:false,companyDeleted:false,companyId:2,sessionVersion:3,role:'hr',locale:'pt-BR',enabledModules:['people']};
test('missing schema never restores sessions through a legacy query, including development',async()=>{
 for(const environment of ['production','development'])for(const code of ['42703','42P01','42501']){
  const error=Object.assign(new Error('schema unavailable'),{code});const f=await fixture({queryError:error,environment});
  await assert.rejects(f.hydrate({userId:1,sv:3}),error);assert.equal(f.queries(),1);
 }
});
test('missing capability override schema denies hydration rather than falling back to role defaults',async()=>{
 const error=Object.assign(new Error('overrides unavailable'),{code:'42P01'});const f=await fixture({row:live,overrideError:error});
 await assert.rejects(f.hydrate({userId:1,sv:3}),error);
});
test('valid sessions retain live role and revoked sessions stay denied',async()=>{
 const f=await fixture({row:live});const payload=await f.hydrate({userId:1,sv:3,role:'admin'});assert.equal(payload.role,'hr');assert.equal(payload.companyId,2);
 assert.equal(await f.hydrate({userId:1,sv:2}),null);assert.equal(await f.hydrate({userId:1}),null);
});
test('the actual capability loader propagates missing-table errors',async()=>{
 const error=Object.assign(new Error('missing table'),{code:'42P01'});const context=vm.createContext({});
 const deps={query:async()=>{throw error;},pool:{},verifySessionWithCapabilities:()=>{},ASSIGNABLE_MODULE_CAPS:[],CAP:{},defaultAssignableModulesForRole:()=>[],modulesMatchRoleDefaults:()=>true};
 const mod=new vm.SourceTextModule(await readFile(new URL('../../lib/user-capabilities.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));await mod.evaluate();
 await assert.rejects(mod.namespace.loadUserCapabilityOverrides(1),error);
});
