'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { t } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';
import { cn } from '../../lib/cn';

function fileSizeLabel(byteSize, locale) {
 const bytes = Math.max(0, Number(byteSize) || 0);
 const [value, unit] = bytes < 1024 ? [bytes, 'B'] : bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / 1024 / 1024, 'MB'];
 return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'B' ? 0 : 1 }).format(value)} ${unit}`;
}

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];

export function postAttachmentUrl(postId,fileId,{admin=false,companyId}={}){
  return admin?`/api/admin/company-feed/posts/${postId}/attachments/${fileId}?companyId=${companyId}`:`/api/employee/feed/${postId}/attachments/${fileId}`;
}

function ImagePreview({ file, src, downloadUrl, locale, onClose }) {
 const titleId = useId();
 const closeRef = useRef(null);

 useEffect(() => {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  closeRef.current?.focus();
  const onKeyDown = (event) => {
   if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
   }
   if (event.key === 'Tab') {
    const controls = [...document.querySelectorAll('[data-image-preview-dialog] button:not(:disabled), [data-image-preview-dialog] a[href]')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
   }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => {
   document.body.style.overflow = previousOverflow;
   window.removeEventListener('keydown', onKeyDown);
  };
 }, [onClose]);

 return createPortal(
  <div className="app-dialog-overlay fixed inset-0 z-[10060] flex items-center justify-center bg-ink/75 p-2 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
   <section data-image-preview-dialog role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[96dvh] w-full max-w-screen-2xl flex-col overflow-hidden rounded-card border border-ink/12 bg-surface shadow-dialog">
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-2.5 sm:px-6">
     <h2 id={titleId} className="m-0 min-w-0 truncate text-base font-semibold text-ink sm:text-lg">{file.fileName}</h2>
     <button ref={closeRef} type="button" onClick={onClose} aria-label={t(locale, 'panel.common.close')} className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-xl leading-none text-ink-muted hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">×</button>
    </header>
    <div className="relative flex min-h-[55vh] min-w-0 flex-1 items-center justify-center overflow-hidden bg-ink/5 p-2 sm:min-h-[68vh] sm:p-4">
     <Image src={src} alt={file.fileName} fill unoptimized sizes="(max-width: 768px) 100vw, 1536px" className="object-contain" />
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
     <span className="text-sm text-ink-muted">{fileSizeLabel(file.byteSize, locale)}</span>
     <a href={downloadUrl} className="inline-flex min-h-touch items-center text-sm font-medium text-brand-700 underline underline-offset-4">{t(locale,'panel.companyFeed.downloadFile')}</a>
    </footer>
   </section>
  </div>, document.body
 );
}

export function CompanyPostAttachments({postId,files=[],locale='pt-BR',admin=false,companyId,onRemove,busy=false,featured=false}){
 const [previewFile, setPreviewFile] = useState(null);
 const triggerRef = useRef(null);
 const closePreview = useCallback(() => {
  setPreviewFile(null);
  requestAnimationFrame(() => triggerRef.current?.focus());
 }, []);
 if(!files.length)return null;
 const largeImage = featured && files.length === 1 && imageTypes.includes(files[0].contentType);
 const previewDownloadUrl = previewFile ? postAttachmentUrl(postId,previewFile.id,{admin,companyId}) : '';
 const previewUrl = previewFile ? `${previewDownloadUrl}${previewDownloadUrl.includes('?')?'&':'?'}preview=1` : '';
 return <>
  <ul className={cn('m-0 mt-3 grid list-none gap-3 p-0', !largeImage && 'sm:grid-cols-2')}>
   {files.map(file=>{const url=postAttachmentUrl(postId,file.id,{admin,companyId});const imageUrl=`${url}${url.includes('?')?'&':'?'}preview=1`;const isImage=imageTypes.includes(file.contentType);return <li key={file.id} className="min-w-0 overflow-hidden rounded-control border border-line bg-surface">
    {isImage?<button type="button" aria-haspopup="dialog" aria-label={`${t(locale,'panel.companyFeed.viewImage')}: ${file.fileName}`} onClick={(event)=>{triggerRef.current=event.currentTarget;setPreviewFile(file);}} className={cn('group relative block w-full cursor-zoom-in overflow-hidden bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500',largeImage?'h-auto max-h-[28rem] sm:max-h-[36rem] aspect-[4/3]':'h-40')}><Image src={imageUrl} alt="" fill unoptimized sizes="(max-width: 768px) 100vw, 50vw" className="object-contain transition-transform duration-200 group-hover:scale-[1.02]" /></button>:null}
    <div className="p-3"><p className="m-0 break-words text-sm font-medium">{file.fileName}</p><p className="mb-2 mt-1 text-xs text-ink-muted">{fileSizeLabel(file.byteSize,locale)}</p>
    <div className="flex flex-wrap items-center gap-2"><a href={url} className="inline-flex min-h-touch items-center text-sm text-brand-700 underline underline-offset-4">{t(locale,'panel.companyFeed.downloadFile')}</a>
    {onRemove?<button type="button" disabled={busy} className={S.btnGhost} aria-label={t(locale,'panel.companyFeed.removeFile',{name:file.fileName})} onClick={()=>onRemove(file)}>{t(locale,'panel.common.remove')}</button>:null}</div></div>
   </li>;})}
  </ul>
  {previewFile && typeof document !== 'undefined' ? <ImagePreview file={previewFile} src={previewUrl} downloadUrl={previewDownloadUrl} locale={locale} onClose={closePreview} /> : null}
 </>;
}
