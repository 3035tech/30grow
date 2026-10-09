import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
import { normalizeLocale } from '../../lib/locale-negotiation.js';
async function load(path, deps) {
 const context = vm.createContext({ console, URL });
 const mod = new vm.SourceTextModule(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'), { context });
 await mod.link(async () => new vm.SyntheticModule(Object.keys(deps), function () { for (const [key,value] of Object.entries(deps)) this.setExport(key,value); }, { context }));
 await mod.evaluate(); return mod.namespace;
}
const common = { z, ERR, HTTP_STATUS, query: null, normalizeLocale, t: (locale,key) => `${locale}:${key}`, NextResponse: { json: (body, init) => ({ body,...init }) }, apiError: (_req,code,status) => ({ code,status }), apiErrorFromResult: (_req,result) => ({ status: 400,code: result.errorCode }), authenticateMobileEmployee: async () => ({ companyId:2,candidateId:20 }), mobileEmployeeBearerToken: () => 'token', getEmployeeProfile: async () => ({ ok:true,person:{preferredLocale:'en'} }), checkRateLimit: async () => ({ok:true}), clientIpFromRequest: () => 'ip', dismissEmployeeWelcome: async () => ({ok:true}) };
test('home paginates without losing deadlines and scopes every attention service to the authenticated tenant', async () => {
 const calls=[];
 const service=(value)=>async (_db,scope)=>{ calls.push(scope);return {ok:true,...value}; };
 const deps={...common,getCompanyEnabledModules:async()=>null,employeeSectionVisible:()=>true,getTimeClockAccess:async()=>({ok:true,enabled:true}),getEmployeeHome:service({locale:'en',person:{fullName:'Person'},company:{name:'Company'},plans:[],courses:[{overdue:true}],okrActivities:[{urgency:'critical'}],tasks:Array.from({length:21},(_,i)=>({id:`okr-${i+1}`,kind:'okr',titleKey:'task',meta:'2026-10-10'}))}),getEmployeeDpHome:service({badge:2}),getEmployeeTimeClockToday:service({open:{}}),listEmployeeSurveyInbox:service({openClimate:[{}],openPulse:[{}]}),listFeedbackInbox:service({items:[{}]}),listEmployeeVisibleCompensation:service({items:[{approvalStatus:'proposed'},{approvalStatus:'approved'}]})};
 const route=await load('app/api/mobile/v1/employee/home/route.js',deps);
 const result=await route.GET({url:'https://example.test/home?page=2&companyId=99'});
 assert.equal(result.body.tasks.length,1);assert.equal(result.body.tasks[0].id,'okr-21');assert.equal(result.body.tasks[0].dueDate,'2026-10-10');assert.equal(result.body.taskPagination.total,21);assert.equal(result.body.taskPagination.totalPages,2);
 assert.equal(result.body.attention.surveys,2);assert.equal(result.body.attention.dp,2);assert.equal(result.body.attention.proposedCompensation,1);assert.equal(result.headers['Cache-Control'],'no-store');
 for(const scope of calls){assert.equal(scope.companyId,2);assert.equal(scope.candidateId??scope.toCandidateId,20);}
 for(const page of ['0','-1','1.5','10001'])assert.equal((await route.GET({url:`https://example.test/home?page=${page}`})).status,400);
 deps.getEmployeeDpHome=async()=>{throw Error('unavailable')};
 const degraded=await(await load('app/api/mobile/v1/employee/home/route.js',deps)).GET({url:'https://example.test/home'});
 assert.equal(degraded.body.attention.dp,null);assert.equal(degraded.body.attention.surveys,2);
 deps.authenticateMobileEmployee=async()=>null;const count=calls.length;
 assert.equal((await(await load('app/api/mobile/v1/employee/home/route.js',deps)).GET({url:'https://example.test/home'})).status,401);assert.equal(calls.length,count);
});
test('notifications use the persisted employee locale and server-owned identity', async () => {
 const deps={...common,normalizeMobilePushDestinations:()=>[],mobilePushDestinationFor:()=>null,resolveMobilePushDestination:()=>null,mobileNotificationTarget:()=>null,markCandidateNotificationRead:async()=>({ok:true}),listCandidateNotifications:async(_db,scope)=>{assert.equal(scope.companyId,2);assert.equal(scope.candidateId,20);return {ok:true,items:[{id:1,copy:{titleKey:'title',bodyKey:'body',values:{}},createdAt:'2026-10-09T12:00:00Z',readAt:null}],unreadCount:1,total:1};}};
 const route=await load('app/api/mobile/v1/employee/notifications/route.js',deps);
 const result=await route.GET({url:'https://example.test/notifications'});assert.equal(result.body.items[0].title,'en:title');assert.equal(result.body.items[0].body,'en:body');
 assert.equal((await route.GET({url:'https://example.test/notifications?companyId=99'})).status,400);
});
test('captcha configuration exposes only public configuration and disables caching', async()=>{
 const route=await load('app/api/mobile/v1/auth/captcha-config/route.js',{...common,isTurnstileConfigured:()=>true,turnstileSiteKey:()=> 'public-key',runtimeAppUrl:()=> 'https://example.test/path'});
 const result=await route.GET();assert.equal(result.body.required,true);assert.equal(result.body.siteKey,'public-key');assert.equal(result.body.origin,'https://example.test');assert.equal(result.headers['Cache-Control'],'no-store');
});
