/** Explicit local DTOV + in-memory object storage; never contacts S3 or production. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {zipSync,strToU8} from 'fflate';
import {dtovEnv,assertDtovTarget} from '../dtov/harness.js';
assert.equal(process.env.POST_FILES_TEST,'1','Explicit local test opt-in required');
const env=dtovEnv();assertDtovTarget(env);Object.assign(process.env,env);
const {pool,withTransaction}=await import('../../lib/db.js');
const {createCompanyPost,listCompanyPosts,softDeleteCompanyPost}=await import('../../lib/company/company-posts.js');
const {uploadPostAttachment,downloadPostAttachment,removePostAttachment,validatePostFile}=await import('../../lib/company/company-post-attachments.js');
const {ERR}=await import('../../lib/api-error-codes.js');
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const file={buffer:png,mimeType:'image/png',originalName:'Foto da equipe.png'};
const objects=new Map();let reads=0;
const storage={put:async({key,body,contentType})=>{objects.set(key,{body,contentType});},remove:async key=>{objects.delete(key);},get:async key=>{reads++;return objects.get(key);}};
let companyA,companyB;
try{
 await pool.query(await readFile(new URL('../../migrations/170_company_post_attachments.sql',import.meta.url),'utf8'));
 await pool.query(await readFile(new URL('../../migrations/170_company_post_attachments.sql',import.meta.url),'utf8'));
 companyA=(await pool.query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',['Synthetic post files A','post-files-'+randomUUID()])).rows[0].id;
 companyB=(await pool.query('INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',['Synthetic post files B','post-files-'+randomUUID()])).rows[0].id;
 const original=await createCompanyPost(null,{companyId:companyA,title:'Existing notice',bodyHtml:'<p>Preserved body</p>'});assert.equal(original.ok,true);
 const postId=original.post.id;
 const options={companyId:companyA,postId,userId:null,file};
 await test('accept valid image, PDF, text and modern Office; reject forged, executable, empty and oversized files',()=>{
  assert.equal(validatePostFile(file).contentType,'image/png');
  assert.equal(validatePostFile({buffer:Buffer.from('%PDF-1.7\n'),originalName:'policy.pdf',mimeType:'application/pdf'}).contentType,'application/pdf');
  assert.equal(validatePostFile({buffer:Buffer.from('Announcement'),originalName:'notice.txt',mimeType:'text/plain'}).contentType,'text/plain');
  for(const [extension,path] of [['docx','word/document.xml'],['xlsx','xl/workbook.xml'],['pptx','ppt/presentation.xml']]){
   const buffer=Buffer.from(zipSync({'[Content_Types].xml':strToU8('<Types/>'),[path]:strToU8('<Document/>')}));assert.ok(validatePostFile({buffer,originalName:'document.'+extension,mimeType:''}).contentType.includes('openxmlformats'));
  }
  for(const bad of [{...file,buffer:Buffer.from('<script>bad</script>')},{...file,originalName:'run.exe'},{...file,buffer:Buffer.alloc(0)},{...file,buffer:Buffer.alloc(10485761)}])assert.throws(()=>validatePostFile(bad));
 });
 await test('concurrent uploads cap at five and preserve notice content; metadata never exposes storage keys',async()=>{
  const results=await Promise.all(Array.from({length:6},()=>uploadPostAttachment({...options,uploadId:randomUUID()},storage)));
  assert.equal(results.filter(result=>result.ok).length,5);assert.equal(results.filter(result=>result.errorCode===ERR.COMPANY_POST_FILE_LIMIT).length,1);assert.equal(objects.size,5);
  const listed=await listCompanyPosts(null,{companyId:companyA});const post=listed.posts.find(row=>row.id===postId);assert.equal(post.attachments.length,5);assert.equal(post.bodyHtml,'<p>Preserved body</p>');assert.ok(!JSON.stringify(post).includes('objectKey'));
 });
 const loaded=(await listCompanyPosts(null,{companyId:companyA})).posts[0];const attachmentId=loaded.attachments[0].id;
 await test('foreign company cannot read, delete or upload files; rejected reads never hit storage',async()=>{
  const before=reads;assert.equal((await downloadPostAttachment({companyId:companyB,postId,attachmentId},storage)).errorCode,ERR.NOT_FOUND);assert.equal(reads,before);
  assert.equal((await removePostAttachment({companyId:companyB,postId,attachmentId})).errorCode,ERR.NOT_FOUND);
  assert.equal((await uploadPostAttachment({...options,companyId:companyB,uploadId:randomUUID()},storage)).errorCode,ERR.NOT_FOUND);
  const downloaded=await downloadPostAttachment({companyId:companyA,postId,attachmentId},storage);assert.equal(downloaded.ok,true);assert.deepEqual(downloaded.body,png);
 });
 await test('composite foreign key rejects a file linked to another company',async()=>{
  await assert.rejects(pool.query("INSERT INTO company_post_attachments(company_id,post_id,upload_id,object_key,file_name,content_type,byte_size) VALUES($1,$2,$3,$4,'x.pdf','application/pdf',1)",[companyB,postId,randomUUID(),'companies/invalid/'+randomUUID()]),error=>error.code==='23503');
 });
 await test('retry uses one attachment, including concurrent retries and a lost commit acknowledgement',async()=>{
  const post=(await createCompanyPost(null,{companyId:companyA,title:'Retry notice',bodyHtml:''})).post;
  const upload={...options,postId:post.id,uploadId:randomUUID()};
  const [a,b]=await Promise.all([uploadPostAttachment(upload,storage),uploadPostAttachment(upload,storage)]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.attachment.id,b.attachment.id);
  const count=objects.size;const retry=await uploadPostAttachment(upload,storage);assert.equal(retry.attachment.id,a.attachment.id);assert.equal(objects.size,count);
  const unknown=await uploadPostAttachment({...upload,uploadId:randomUUID()},{...storage,transaction:async work=>{await withTransaction(work);throw Error('lost commit acknowledgement');}});assert.equal(unknown.ok,true);assert.ok(objects.size>count);
 });
 await test('removed files and removed notices cannot be downloaded',async()=>{
  assert.equal((await removePostAttachment({companyId:companyA,postId,attachmentId})).ok,true);
  assert.equal((await downloadPostAttachment({companyId:companyA,postId,attachmentId},storage)).errorCode,ERR.NOT_FOUND);
  const second=loaded.attachments[1].id;await softDeleteCompanyPost(null,{companyId:companyA,postId});
  assert.equal((await downloadPostAttachment({companyId:companyA,postId,attachmentId:second},storage)).errorCode,ERR.NOT_FOUND);
 });
}finally{
 for(const id of [companyA,companyB])if(id)await pool.query('DELETE FROM companies WHERE id=$1',[id]);
 await pool.end();
}
