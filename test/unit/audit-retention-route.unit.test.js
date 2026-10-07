import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
test('audit cron defaults to preview and cannot delete without explicit execution gate', async () => {
  const calls=[]; let authorized=true;
  const environment={};
  const deps={ query:()=>{},withTransaction:()=>{},ERR,HTTP_STATUS,verifyCronRequest:()=>authorized,
    apiError:(_r,code,status)=>({code,status}), purgeAuditLog:async (_db,opts)=>{calls.push(opts);return {dryRun:opts.dryRun,deleted:0};}, audit:async()=>{},AUDIT_ACTOR_KIND:{SYSTEM:'system'},
  };
  const context=vm.createContext({URL,Response,process:{env:environment},console});
  const mod=new vm.SourceTextModule(await readFile(new URL('../../app/api/cron/audit-retention/route.js',import.meta.url),'utf8'),{context});
  await mod.link(async()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));
  await mod.evaluate();
  const request=(qs='')=>({url:`https://example.com/cron${qs}`});
  const preview=await mod.namespace.POST(request()); assert.equal((await preview.json()).dryRun,true);
  assert.equal((await mod.namespace.POST(request('?dryRun=false'))).status,403); assert.equal(calls.length,1);
  assert.equal((await mod.namespace.POST(request('?afterCompanyId=evil'))).status,400); assert.equal(calls.length,1);
  authorized=false; assert.equal((await mod.namespace.POST(request())).status,401);
  authorized=true; environment.AUDIT_RETENTION_EXECUTE='1';
  await mod.namespace.POST(request('?dryRun=false&afterCompanyId=42'));
  assert.equal(calls.at(-1).dryRun,false);assert.equal(calls.at(-1).afterCompanyId,42);
});
test('policy reads catch session failures; denied access and invalid input cannot write', async () => {
  const { z } = await import('zod');
  let payload = { role: 'hr' }, sessionFailure = false, writes = 0;
  const deps = { z, ERR, HTTP_STATUS, cookies: async () => ({ get: () => ({ value: 'test' }) }), COOKIE_NAME: 'session',
    verifySessionWithCapabilities: async () => { if (sessionFailure) throw new Error('session unavailable'); return payload; },
    CAP: { AUDIT_VIEW: 'audit.view' }, can: () => true, isSuperAdminPayload: (v) => v?.role === 'admin',
    apiError: (_req, code, status, _values, init) => ({ code, status, ...init }),
    parseJsonBody: async (req, schema) => { const parsed = schema.safeParse(await req.json()); return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: new Response('{}', { status: 400 }) }; },
    query: async () => { writes++; return { rows: [], rowCount: 0 }; }, withTransaction: async () => { writes++; },
  };
  const context = vm.createContext({ Response, console });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/audit-log/retention/route.js', import.meta.url), 'utf8'), { context });
  await mod.link(async () => new vm.SyntheticModule(Object.keys(deps), function () { for (const [k,v] of Object.entries(deps)) this.setExport(k,v); }, { context }));
  await mod.evaluate();
  const denied = await mod.namespace.GET({});
  assert.equal(denied.status,403); assert.equal(denied.headers['Cache-Control'],'no-store'); assert.equal(writes,0);
  payload = { role: 'admin' };
  const invalid = await mod.namespace.POST({ json: async () => ({}) });
  assert.equal(invalid.status,400); assert.equal(invalid.headers.get('Cache-Control'),'no-store'); assert.equal(writes,0);
  sessionFailure = true;
  const failure = await mod.namespace.GET({});
  assert.equal(failure.status,500); assert.equal(failure.headers['Cache-Control'],'no-store'); assert.equal(writes,0);
});
