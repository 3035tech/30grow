import { query, withTransaction } from './db.js';
import { ERR } from './api-error-codes.js';
import { detectImageMimeFromBuffer, isPdfBuffer } from './file-magic.js';
import { unzipSync } from 'fflate';
import { POST_FILE_MAX_COUNT, POST_FILE_TYPES, postFileSelectionError } from './company-post-file-rules.js';
import { companyScopedObjectKey, opaqueObjectFileName, putObject, getObjectBytes, deleteObjectBestEffort } from './s3-object-storage.js';

const PROJECTION = 'id, post_id AS "postId", file_name AS "fileName", content_type AS "contentType", byte_size AS "byteSize", created_at AS "createdAt"';
export function validatePostFile(file) {
  const error=postFileSelectionError({name:file?.originalName,type:file?.mimeType,size:file?.buffer?.length});
  if(error)throw Object.assign(new Error(error),{code:ERR[error]});
  const buffer=file.buffer, ext=String(file.originalName).split('.').pop().toLowerCase(), mime=POST_FILE_TYPES[ext];
  let valid=false;
  if(mime.startsWith('image/'))valid=detectImageMimeFromBuffer(buffer)===mime;
  else if(ext==='pdf')valid=isPdfBuffer(buffer);
  else if(ext==='txt'){
    try{const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);valid=!/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text);}catch{}
  }else{
    const required={docx:'word/document.xml',xlsx:'xl/workbook.xml',pptx:'ppt/presentation.xml'}[ext];
    const entries=new Set();let count=0,macro=false;
    try{unzipSync(buffer,{filter:entry=>{if(++count>2000)throw Error('too_many_entries');entries.add(entry.name);if(/vbaProject\.bin$/i.test(entry.name))macro=true;return false;}});valid=entries.has('[Content_Types].xml')&&entries.has(required)&&!macro;}catch{}
  }
  if(!valid)throw Object.assign(new Error(ERR.COMPANY_POST_FILE_TYPE),{code:ERR.COMPANY_POST_FILE_TYPE});
  return {contentType:mime,extension:ext,fileName:String(file.originalName).replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,200)};
}

export async function loadPostAttachments(db,companyId,postIds){
  if(!postIds.length)return new Map();
  const result=await db.query(`SELECT ${PROJECTION} FROM company_post_attachments WHERE company_id=$1 AND post_id=ANY($2::bigint[]) AND deleted=false ORDER BY created_at,id`,[companyId,postIds]);
  const byPost=new Map();for(const row of result.rows){const key=String(row.postId);if(!byPost.has(key))byPost.set(key,[]);byPost.get(key).push(row);}return byPost;
}

export async function uploadPostAttachment({companyId,postId,userId,file,uploadId},{db={query},transaction=withTransaction,put=putObject,remove=deleteObjectBestEffort}={}){
  const owned=await db.query('SELECT id FROM company_posts WHERE id=$1 AND company_id=$2 AND deleted=false',[postId,companyId]);
  if(!owned.rowCount)return {ok:false,errorCode:ERR.NOT_FOUND};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId||''))return {ok:false,errorCode:ERR.INVALID_DATA};
  const previous=await db.query(`SELECT ${PROJECTION} FROM company_post_attachments WHERE company_id=$1 AND post_id=$2 AND upload_id=$3 AND deleted=false`,[companyId,postId,uploadId]);
  if(previous.rowCount)return {ok:true,attachment:previous.rows[0]};
  const meta=validatePostFile(file);
  const key=companyScopedObjectKey(companyId,'company-posts',String(postId),opaqueObjectFileName(meta.extension));
  try{await put({key,body:file.buffer,contentType:meta.contentType,cacheControl:'private, no-store'});}catch(error){await remove(key);throw error;}
  try{
    const result=await transaction(async client=>{
      const parent=await client.query('SELECT id FROM company_posts WHERE id=$1 AND company_id=$2 AND deleted=false FOR UPDATE',[postId,companyId]);
      if(!parent.rowCount)return {ok:false,errorCode:ERR.NOT_FOUND};
      const existing=await client.query(`SELECT ${PROJECTION},deleted FROM company_post_attachments WHERE company_id=$1 AND post_id=$2 AND upload_id=$3`,[companyId,postId,uploadId]);
      if(existing.rowCount)return existing.rows[0].deleted?{ok:false,errorCode:ERR.INVALID_ACTION}:{ok:true,attachment:existing.rows[0],unusedObject:true};
      const count=await client.query('SELECT count(*)::int AS n FROM company_post_attachments WHERE company_id=$1 AND post_id=$2 AND deleted=false',[companyId,postId]);
      if(count.rows[0].n>=POST_FILE_MAX_COUNT)return {ok:false,errorCode:ERR.COMPANY_POST_FILE_LIMIT};
      const inserted=await client.query(`INSERT INTO company_post_attachments(company_id,post_id,object_key,file_name,content_type,byte_size,created_by_user_id,upload_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${PROJECTION}`,[companyId,postId,key,meta.fileName,meta.contentType,file.buffer.length,userId,uploadId]);
      return {ok:true,attachment:inserted.rows[0]};
    });
    if(!result.ok||result.unusedObject)await remove(key);
    return result;
  }catch(error){
    // A lost COMMIT acknowledgement must never delete an already-linked file.
    try{const committed=await db.query(`SELECT ${PROJECTION} FROM company_post_attachments WHERE object_key=$1 AND company_id=$2 AND post_id=$3`,[key,companyId,postId]);if(committed.rowCount)return {ok:true,attachment:committed.rows[0]};await remove(key);}catch{}
    throw error;
  }
}

export async function removePostAttachment({companyId,postId,attachmentId},db={query}){
  const result=await db.query(`UPDATE company_post_attachments a SET deleted=true FROM company_posts p WHERE a.id=$1 AND a.company_id=$2 AND a.post_id=$3 AND p.id=a.post_id AND p.company_id=a.company_id AND p.deleted=false AND a.deleted=false RETURNING a.id`,[attachmentId,companyId,postId]);
  return result.rowCount?{ok:true}:{ok:false,errorCode:ERR.NOT_FOUND};
}

export async function downloadPostAttachment({companyId,postId,attachmentId},{db={query},get=getObjectBytes}={}){
  const result=await db.query(`SELECT a.object_key AS "objectKey",a.file_name AS "fileName",a.content_type AS "contentType" FROM company_post_attachments a JOIN company_posts p ON p.id=a.post_id AND p.company_id=a.company_id WHERE a.id=$1 AND a.company_id=$2 AND a.post_id=$3 AND a.deleted=false AND p.deleted=false`,[attachmentId,companyId,postId]);
  const row=result.rows[0];
  if(!row||!row.objectKey.startsWith(companyScopedObjectKey(companyId,'company-posts',String(postId))+'/'))return {ok:false,errorCode:ERR.NOT_FOUND};
  const stored=await get(row.objectKey);return {ok:true,body:stored.body,contentType:row.contentType,fileName:row.fileName};
}
