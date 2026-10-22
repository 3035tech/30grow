import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import pg from 'pg';
import { createProductFeedback, updateProductFeedback, listProductFeedback } from '../../lib/product-feedback.js';

test('support: migration preserves legacy evidence, triage is private and only a visible reply meets response SLA', {skip:process.env.SUPPORT_PG_TEST!=='1'},async()=>{
 const db=new pg.Client({host:'127.0.0.1',port:55488,user:'postgres',password:'local-rejection-test',database:'rejection_validation'});
 await db.connect(); await db.query('BEGIN');
 try {
 const migration=await readFile(new URL('../../migrations/168_support_response_visibility.sql',import.meta.url),'utf8');
 const cid=(await db.query("INSERT INTO companies(name,slug) VALUES('Support test','support-'||gen_random_uuid()::text) RETURNING id")).rows[0].id;
 const uid=(await db.query("INSERT INTO users(email,password_hash,role,company_id) VALUES('support-'||gen_random_uuid()::text||'@example.test','fixture','hr',$1) RETURNING id",[cid])).rows[0].id;
 const created=await createProductFeedback(db,{companyId:cid,userId:uid,kind:'question',message:'How do I use this feature?',contactOk:true}); assert.equal(created.ok,true);
 await db.query("UPDATE product_feedback SET first_response_at='2026-01-01T10:00:00Z',admin_notes='PRIVATE NOTE' WHERE id=$1",[created.id]);
 const before=(await db.query("SELECT md5((to_jsonb(f)-'first_triaged_at'-'public_response')::text) AS digest FROM product_feedback f WHERE id=$1",[created.id])).rows[0].digest;
 await db.query(migration); await db.query(migration);
 assert.equal((await db.query("SELECT md5((to_jsonb(f)-'first_triaged_at'-'public_response')::text) AS digest FROM product_feedback f WHERE id=$1",[created.id])).rows[0].digest,before);
 const internal=await updateProductFeedback(db,{id:created.id,status:'reviewing',adminNotes:'STILL PRIVATE'});
 assert.equal(internal.item.firstResponseAt,null); assert.ok(internal.item.firstTriagedAt);
 assert.equal((await updateProductFeedback(db,{id:created.id,status:'done'})).ok,false);
 const reply=await updateProductFeedback(db,{id:created.id,publicResponse:'Here is how to use it.'}); assert.ok(reply.item.firstResponseAt); const first=reply.item.firstResponseAt;
 const revised=await updateProductFeedback(db,{id:created.id,publicResponse:'Updated instructions.'}); assert.equal(+revised.item.firstResponseAt,+first);
 const closed=await updateProductFeedback(db,{id:created.id,status:'done'}); assert.equal(closed.ok,true);
 let identity={userId:uid,companyId:cid};
 const deps={NextResponse:{json:Response.json},CAP:{PROFILE_SELF:'self'},query:(s,v)=>db.query(s,v),withAdminApi:(_opts,handler)=>()=>handler({payload:identity})};
 const context=vm.createContext({}); const module=new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/product-feedback/mine/route.js',import.meta.url),'utf8'),{context});
 await module.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const[k,v]of Object.entries(deps))this.setExport(k,v);},{context}));await module.evaluate();
 const mine=await (await module.namespace.GET()).json(); assert.equal(mine.items.length,1); assert.equal(mine.items[0].publicResponse,'Updated instructions.');assert.ok(!JSON.stringify(mine).includes('PRIVATE'));
 identity={userId:Number(uid)+99999,companyId:cid}; assert.equal((await (await module.namespace.GET()).json()).items.length,0);
 identity={userId:uid,companyId:Number(cid)+99999}; assert.equal((await (await module.namespace.GET()).json()).items.length,0);
 }finally{await db.query('ROLLBACK');await db.end();}
});
