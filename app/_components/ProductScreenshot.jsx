'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { screenshotLabels } from '../../lib/marketing/product-screenshots';

export function ProductScreenshot({ image, title, locale, eager = false, sizes = '(max-width: 767px) calc(100vw - 40px), 960px' }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const [opened, setOpened] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const labels = screenshotLabels(locale);

  useEffect(() => {
    if (!opened) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [opened]);

  if (!image) return null;
  const open = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!dialogRef.current?.showModal) return;
    event.preventDefault();
    dialogRef.current.showModal();
    setOpened(true);
  };
  const close = () => dialogRef.current?.close();

  return <figure className="m-0 min-w-0">
    <a href={image.src} target="_blank" rel="noopener noreferrer" onClick={open} aria-label={`${labels.enlarge}: ${title}`} aria-haspopup="dialog" className="group relative block overflow-hidden rounded-card border border-ink/10 bg-canvas shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-600">
      <Image src={image.src} width={image.width} height={image.height} alt={`${title}. ${labels.note}`} sizes={sizes} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : undefined} className="block aspect-[8/5] h-auto w-full object-contain" />
      <span aria-hidden="true" className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-ink/10 bg-white text-brand-700 shadow-sm group-hover:bg-brand-50 group-focus-visible:bg-brand-50"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" /></svg></span>
    </a>
    <figcaption className="mt-4">
      <div className="flex items-start justify-between gap-4"><span className="text-sm font-semibold leading-6 text-ink">{title}</span><a href={image.src} target="_blank" rel="noopener noreferrer" onClick={open} aria-haspopup="dialog" aria-label={`${labels.enlarge}: ${title}`} className="inline-flex min-h-touch shrink-0 items-center text-xs font-semibold text-brand-700 underline underline-offset-4">{labels.enlarge}</a></div>
      <p className="mb-0 mt-1 text-xs leading-5 text-ink-muted">{labels.note}</p>
    </figcaption>
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={() => { setOpened(false); setZoomed(false); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="fixed inset-0 m-auto w-[calc(100%-24px)] max-w-[1440px] max-h-[calc(100dvh-24px)] overflow-hidden rounded-card border border-ink/15 bg-surface p-0 text-ink shadow-xl backdrop:bg-black/70">
      <header className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-3 sm:px-6"><div className="min-w-0"><h2 id={titleId} className="m-0 text-base font-semibold leading-6">{title}</h2><p className="mb-0 mt-1 text-xs leading-5 text-ink-muted">{labels.note}</p></div><button type="button" onClick={close} autoFocus aria-label={labels.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-ink/15 text-2xl hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">×</button></header>
      <div tabIndex={0} aria-label={title} className="max-h-[65dvh] overflow-auto bg-canvas p-2 sm:p-4">
        {opened ? <Image src={image.src} width={image.width} height={image.height} alt={`${title}. ${labels.note}`} unoptimized className="block h-auto" style={{ width: zoomed ? image.width : '100%', maxWidth: zoomed ? 'none' : '100%' }} /> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 px-4 py-3 sm:px-6"><button type="button" aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)} className="inline-flex min-h-touch items-center rounded-control border border-ink/15 px-4 text-sm font-semibold hover:bg-canvas">{zoomed ? labels.fit : labels.zoom}</button><a href={image.src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-touch items-center text-sm font-semibold text-brand-700 underline underline-offset-4">{labels.original}</a></footer>
    </dialog>
  </figure>;
}
