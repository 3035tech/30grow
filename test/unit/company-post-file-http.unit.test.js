import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {privateAttachmentResponse} from '../../lib/private-attachment-response.js';
import {ERR} from '../../lib/api-error-codes.js';
async function handler(contentType,allowed=true){
 let calls=0;const deps={privateAttachmentResponse,ERR,checkRateLimit:async()=>({ok:allowed}),apiError:(_req,code,status)=>Response.json({errorCode:code},{status}),apiErrorFromResult:()=>new Response(null,{status:404}),downloadPostAttachment:async()=>{calls++;return {ok:true,body:new Uint8Array([1,2]),contentType,fileName:'Private notice.pdf'};}};
 const context=vm.createContext({Response,URL});const module=new vm.SourceTextModule(await readFile(new URL('../../lib/company/company-post-file-http.js',import.meta.url),'utf8'),{context});
 await module.link(()=>new vm.SyntheticModule(Object.keys(deps),function(){for(const [key,value]of Object.entries(deps))this.setExport(key,value);},{context}));await module.evaluate();return {send:module.namespace.companyPostFileResponse,calls:()=>calls};
}
test('raster preview stays authenticated and private; files default to safe downloads',async()=>{
 for(const type of ['image/png','application/pdf']){
  const h=await handler(type),r=await h.send(new Request('https://grow.example/file?preview=1'),'employee:7',{companyId:3});
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.ok(r.headers.get('content-disposition').startsWith(type==='image/png'?'inline':'attachment'));
  assert.equal(r.headers.get('location'),null);
 }
});
test('rate limit blocks object reads before retrieving file bytes',async()=>{
 const h=await handler('image/png',false);const r=await h.send(new Request('https://grow.example/file'),'employee:7',{});assert.equal(r.status,429);assert.equal(h.calls(),0);
});
