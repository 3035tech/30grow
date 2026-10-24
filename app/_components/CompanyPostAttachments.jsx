'use client';
import { t } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';

export function postAttachmentUrl(postId,fileId,{admin=false,companyId}={}){
  return admin?`/api/admin/company-feed/posts/${postId}/attachments/${fileId}?companyId=${companyId}`:`/api/employee/feed/${postId}/attachments/${fileId}`;
}
export function CompanyPostAttachments({postId,files=[],locale='pt-BR',admin=false,companyId,onRemove,busy=false}){
 if(!files.length)return null;
 return <ul className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2">
  {files.map(file=>{const url=postAttachmentUrl(postId,file.id,{admin,companyId});return <li key={file.id} className="min-w-0 overflow-hidden rounded-control border border-line bg-surface">
   {['image/jpeg','image/png','image/webp'].includes(file.contentType)?<a href={url} className="block"><img src={`${url}${url.includes('?')?'&':'?'}preview=1`} alt={file.fileName} loading="lazy" className="block h-40 w-full object-contain bg-canvas" /></a>:null}
   <div className="p-3"><p className="m-0 break-words text-sm font-medium">{file.fileName}</p><p className="mb-2 mt-1 text-xs text-ink-muted">{(Number(file.byteSize)/1024/1024).toFixed(2)} MB</p>
   <div className="flex flex-wrap items-center gap-2"><a href={url} className="inline-flex min-h-touch items-center text-sm text-brand-700 underline underline-offset-4">{t(locale,'panel.companyFeed.downloadFile')}</a>
   {onRemove?<button type="button" disabled={busy} className={S.btnGhost} aria-label={t(locale,'panel.companyFeed.removeFile',{name:file.fileName})} onClick={()=>onRemove(file)}>{t(locale,'panel.common.remove')}</button>:null}</div></div>
  </li>;})}
 </ul>;
}
