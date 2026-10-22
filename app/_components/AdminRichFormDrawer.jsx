'use client';

import { useFormDirty, useUnsavedChanges } from './useUnsavedChanges';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t as i18nT } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { UI_TYPE } from '../../lib/ui-typography';
import { dialogOverlayClass } from './app-dialog-styles';
import { DialogCloseButton } from './DialogCloseButton';

/**
 * Wide form shell for rich create/edit (vacancies, etc.).
 * Not a field builder — host existing form JSX as children.
 */
export function AdminRichFormDrawer({
  open,
  title,
  locale = 'pt-BR',
  onClose,
  children,
  footer,
  maxWidth = '820px',
  fullPage = false,
  withinShell = false,
  headerMeta = null,
  headerActions = null,
  backLabel: backLabelOverride = null,
  closeLabel: closeLabelOverride = null,
  eyebrow = null,
  protectChanges = Boolean(footer),
  dirty: controlledDirty = null,
  busy = false,
}) {
  const titleId = useId();
  const TitleTag = fullPage ? 'h1' : 'h2';
  const eyebrowText = eyebrow || (fullPage ? i18nT(locale, 'ui.adminRichFormDrawer.peopleTeam') : '');
  const [mounted, setMounted] = useState(false);
  const contentRef = useRef(null);
  const panelRef = useRef(null);
  const detectedDirty = useFormDirty(open && mounted, panelRef, protectChanges && controlledDirty == null);
  const dirty = controlledDirty ?? detectedDirty;
  const { requestClose, confirmation } = useUnsavedChanges({ open, dirty, onClose, locale, panelRef, blocked: busy });
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const panel = panelRef.current;
    const previousFocus = document.activeElement;
    const stackingLevel = element => {
      let level = 0;
      for (let node = element; node; node = node.parentElement) level = Math.max(level, Number.parseInt(getComputedStyle(node).zIndex, 10) || 0);
      return level;
    };
    const isTop = () => ![...document.querySelectorAll('[role="dialog"]')].some(other =>
      other !== panel && other.getClientRects().length &&
      (stackingLevel(other) > stackingLevel(panel) ||
        (stackingLevel(other) === stackingLevel(panel) && (panel.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)))
    );
    const focusable = () => [...panel.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length);
    const focusFirst = () => (focusable()[0] || panel).focus();
    const frame = !withinShell ? requestAnimationFrame(focusFirst) : null;
    const onKey = (e) => {
      if (!isTop()) return;
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current?.();
      if (withinShell || e.key !== 'Tab' || e.defaultPrevented) return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!items.length || !panel.contains(document.activeElement) ||
        (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last || panel : first || panel).focus();
      }
    };
    const onFocus = event => { if (!withinShell && isTop() && !panel.contains(event.target)) focusFirst(); };
    const prevOverflow = document.body.style.overflow;
    if (!withinShell) document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (!withinShell) document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (!withinShell && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mounted, open, withinShell]);

  useEffect(() => {
    if (!open || !fullPage) return;
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [fullPage, open, title]);

  if (!mounted || !open) return null;

  const backLabel = backLabelOverride || (i18nT(locale, 'ui.adminRichFormDrawer.backToTeam'));
  const closeLabel = closeLabelOverride || (i18nT(locale, 'ui.adminRichFormDrawer.closeProfile'));

  const content = (
    <>
    <div
      className={cn(
        withinShell ? 'w-full bg-canvas' : 'app-dialog-overlay',
        !withinShell && (fullPage ? 'fixed inset-0 z-[10050] flex bg-canvas' : dialogOverlayClass)
      )}
      role="presentation"
      onClick={(e) => {
        if (fullPage || withinShell) return;
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role={withinShell ? 'region' : 'dialog'}
        {...(!withinShell ? { 'aria-modal': 'true' } : {})}
        aria-labelledby={titleId}
        className={cn(
          'admin-rich-drawer-panel flex flex-col overflow-hidden border border-ink/12 bg-white',
          fullPage
            ? cn(
                'w-full border-0 bg-canvas shadow-none',
                withinShell ? 'min-h-screen overflow-visible' : 'h-screen'
              )
            : 'mx-6 my-6 max-h-[92vh] rounded-card shadow-dialog'
        )}
        style={fullPage ? undefined : { width: `min(100%, ${maxWidth})` }}
        onClickCapture={(event) => {
          const button = event.target.closest?.('button');
          const label = button?.textContent?.trim();
          if (dirty && button && [i18nT(locale, 'panel.common.cancel'), closeLabel, backLabel].includes(label)) {
            event.preventDefault(); event.stopPropagation(); requestClose();
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn(
          'flex flex-shrink-0 items-start justify-between gap-3 border-b border-ink/12 px-[22px] pb-3.5 pt-[18px]',
          fullPage && !withinShell && 'mx-auto w-full max-w-[1180px] px-4 sm:px-8 lg:px-10',
          withinShell && 'sticky top-0 z-20 border-b-ink/10 bg-canvas/95 px-0 py-3.5 backdrop-blur-sm'
        )}>
          <div className="min-w-0">
            {fullPage ? (
              <button
                type="button"
                onClick={() => requestClose()}
                aria-label={backLabel}
                className="mb-3 flex w-fit min-h-touch items-center rounded-control border border-ink/12 bg-transparent px-3 py-1.5 font-ui text-prose text-ink-muted transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35"
              >
                ← {backLabel}
              </button>
            ) : null}
            {eyebrowText ? <span className={UI_TYPE.label}>{eyebrowText}</span> : null}
            <TitleTag
              id={titleId}
              className={cn(
                'mb-0 break-words',
                eyebrowText && 'mt-1.5',
                fullPage ? UI_TYPE.page : UI_TYPE.section
              )}
            >
              {title}
            </TitleTag>
            {headerMeta ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 font-ui text-prose text-ink/75">
                {headerMeta}
              </div>
            ) : null}
          </div>
          <div className={cn('flex shrink-0 items-start gap-2', fullPage && 'mt-8')}>
            {headerActions}
            <DialogCloseButton onClick={() => requestClose()} locale={locale} label={fullPage ? closeLabel : undefined} />
          </div>
        </div>
        <div ref={contentRef} className={cn(
          'flex-1 px-[22px] py-[18px]',
          !withinShell && 'overflow-y-auto',
          fullPage && !withinShell && 'mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-8 sm:py-8 lg:px-10',
          fullPage && withinShell && 'px-0 py-5 sm:py-6'
        )}>{children}</div>
        {footer ? (
          <div className={cn(
            'flex flex-shrink-0 flex-wrap justify-end gap-2.5 border-t border-ink/12 px-[22px] pb-[18px] pt-3.5',
            fullPage && !withinShell && 'mx-auto w-full max-w-[1180px] px-4 sm:px-8 lg:px-10'
          )}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
    {confirmation}
    </>
  );

  return withinShell ? content : createPortal(content, document.body);
}

export { dialogBtnGhostClass, dialogBtnPrimaryClass } from './app-dialog-styles';
