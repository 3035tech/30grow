'use client';
import { useState } from 'react';
import { AdminRichFormDrawer, dialogBtnGhostClass, dialogBtnPrimaryClass } from './AdminRichFormDrawer';
import { RichTextEditor } from './RichTextEditor';
import { FormField } from './FormField';
import { InlineCallout } from './InlineCallout';
import { CompanyPostAttachments, postAttachmentUrl } from './CompanyPostAttachments';
import { useAppFeedback } from './AppFeedback';
import { S } from '../dashboard/dashboard-shared';
import { t,errorMessage } from '../../lib/i18n';
import { POST_FILE_ACCEPT,POST_FILE_MAX_COUNT,postFileSelectionError } from '../../lib/company/company-post-file-rules';

export function CompanyPostEditor({post=null,companyId,locale='pt-BR',onClose,onSaved}){
 const {confirm}=useAppFeedback();
 const [postId,setPostId]=useState(post?.id||null);
 const [title,setTitle]=useState(post?.title||'');
 const [bodyHtml,setBodyHtml]=useState(post?.bodyHtml||'');
 const [files,setFiles]=useState(post?.attachments||[]);
 const [pending,setPending]=useState([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [uploading,setUploading]=useState(false);
 const copy=(key,values)=>t(locale,`panel.companyFeed.${key}`,values);
 const dirty=title!==(post?.title||'')||bodyHtml!==(post?.bodyHtml||'')||pending.length>0;
 function selectFiles(event){
  const selected=[...event.target.files];event.target.value='';
  if(selected.length+pending.length+files.length>POST_FILE_MAX_COUNT){setError(errorMessage(locale,'COMPANY_POST_FILE_LIMIT'));return;}
  for(const file of selected){const issue=postFileSelectionError(file);if(issue){setError(errorMessage(locale,issue));return;}}
  setError('');setPending(current=>[...current,...selected.map(file=>({id:crypto.randomUUID(),file}))]);
 }
 async function remove(file){
  if(!await confirm({title:copy('removeFileConfirm'),message:file.fileName,danger:true}))return;
  setBusy(true);setError('');
  try{const response=await fetch(postAttachmentUrl(postId,file.id,{admin:true,companyId}),{method:'DELETE'});if(!response.ok)throw Error();setFiles(current=>current.filter(item=>item.id!==file.id));}
  catch{setError(copy('fileRemoveError'));}finally{setBusy(false);}
 }
 async function cancel(){
  if(busy)return;
  if(!dirty||await confirm({title:t(locale,'formValidation.discardTitle'),message:t(locale,'formValidation.discardBody'),confirmLabel:t(locale,'formValidation.discard'),cancelLabel:t(locale,'formValidation.keepEditing'),danger:true}))onClose();
 }
 async function save(){
  if(busy||!title.trim())return;
  setBusy(true);setError('');let metadataSaved=false;
  try{
   const response=await fetch(postId?`/api/admin/company-feed/posts/${postId}`:'/api/admin/company-feed/posts',{method:postId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,title:title.trim(),bodyHtml})});
   const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw Error(result.error||copy('saveError'));
   const id=postId||result.post.id;setPostId(id);metadataSaved=true;
   setUploading(pending.length>0);const remaining=[...pending];
   for(const entry of pending){
    const form=new FormData();form.set('file',entry.file);
    const upload=await fetch(`/api/admin/company-feed/posts/${id}/attachments?companyId=${companyId}&uploadId=${entry.id}`,{method:'POST',body:form});
    const data=await upload.json().catch(()=>({}));if(!upload.ok||!data.ok)throw Error(data.error||copy('saveError'));
    setFiles(current=>current.some(file=>file.id===data.attachment.id)?current:[...current,data.attachment]);
    remaining.shift();setPending([...remaining]);
   }
   onSaved();
  }catch(failure){setError(metadataSaved&&pending.length?`${copy('uploadPartial')} ${failure.message}`:failure.message||copy('saveError'));}
  finally{setUploading(false);setBusy(false);}
 }
 return <AdminRichFormDrawer open title={copy(post?'editPost':'createPost')} locale={locale} onClose={onClose} dirty={dirty} busy={busy} footer={<>
  <button type="button" disabled={busy} className={dialogBtnGhostClass} onClick={cancel}>{t(locale,'panel.common.cancel')}</button>
  <button type="button" disabled={busy||!title.trim()} className={dialogBtnPrimaryClass} onClick={save}>{uploading?copy('uploadingFiles'):busy?t(locale,'panel.common.loading'):post?t(locale,'panel.common.save'):copy('publish')}</button>
 </>}>
  <div className="flex flex-col gap-4">
   {error?<InlineCallout tone="danger" role="alert">{error}</InlineCallout>:null}
   <FormField htmlFor="company-post-title" label={copy('fieldTitle')}><input id="company-post-title" className={S.input} value={title} maxLength={200} disabled={busy} onChange={event=>setTitle(event.target.value)} /></FormField>
   <FormField label={copy('fieldBody')}><RichTextEditor value={bodyHtml} onChange={setBodyHtml} locale={locale} disabled={busy} aria-label={copy('fieldBody')} /></FormField>
   <section aria-label={copy('attachmentsTitle')}><h3 className="m-0 text-sm font-semibold">{copy('attachmentsTitle')}</h3><p className="mb-3 mt-1 text-sm text-ink-muted">{copy('attachmentHint')}</p>
    <input type="file" multiple accept={POST_FILE_ACCEPT} aria-label={copy('attachFiles')} onChange={selectFiles} disabled={busy||files.length+pending.length>=POST_FILE_MAX_COUNT} className="block w-full text-sm file:mr-3 file:rounded-control file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-ink" />
    <CompanyPostAttachments postId={postId} files={files} locale={locale} admin companyId={companyId} onRemove={remove} busy={busy}/>
    {pending.length?<ul aria-label={copy('pendingFiles')} className="mt-3 list-none space-y-2 p-0">{pending.map(entry=><li key={entry.id} className="flex items-center justify-between gap-2 rounded-control border border-dashed border-line p-3 text-sm"><span className="break-all">{entry.file.name}</span><button type="button" className={S.btnGhost} disabled={busy} aria-label={copy('removeFile',{name:entry.file.name})} onClick={()=>setPending(current=>current.filter(item=>item.id!==entry.id))}>{t(locale,'panel.common.remove')}</button></li>)}</ul>:null}
   </section>
  </div>
 </AdminRichFormDrawer>;
}
