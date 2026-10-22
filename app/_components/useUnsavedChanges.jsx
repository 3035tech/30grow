'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { t } from '../../lib/i18n';

export function useUnsavedChanges({ open, dirty, onClose, locale, blocked = false, panelRef }) {
  const [asking, setAsking] = useState(false);
  const pending = useRef(null);
  const returnFocus = useRef(null);
  const state = useRef({ dirty, blocked, onClose });
  state.current = { dirty, blocked, onClose };
  const requestClose = useCallback((afterClose) => {
    if (state.current.blocked || pending.current) return;
    const close = () => { state.current.onClose?.(); if (typeof afterClose === 'function') afterClose(); };
    if (!state.current.dirty) return close();
    returnFocus.current = document.activeElement;
    pending.current = close;
    setAsking(true);
  }, []);
  useEffect(() => {
    if (!open) { pending.current = null; setAsking(false); return; }
    const unload = event => { if (state.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = event => {
      if (!state.current.dirty || event.defaultPrevented) return;
      const target = event.target.closest?.('a[href],button[role="tab"],button[id$="-tab"]');
      if (!target || target.closest('[role="dialog"]') || panelRef?.current?.contains(target)) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      requestClose(() => { state.current.dirty = false; target.click(); });
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [open, panelRef, requestClose]);
  const confirmation = <ConfirmDialog danger preferCancel open={open && asking} locale={locale}
    title={t(locale, 'formValidation.discardTitle')} message={t(locale, 'formValidation.discardBody')}
    confirmLabel={t(locale, 'formValidation.discard')} cancelLabel={t(locale, 'formValidation.keepEditing')}
    onCancel={() => {
      pending.current = null;
      setAsking(false);
      requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus(); });
    }}
    onConfirm={() => { const close = pending.current; pending.current = null; setAsking(false); close?.(); }} />;
  return { requestClose, confirmation };
}

function snapshot(panel) {
  return JSON.stringify([...panel.querySelectorAll('input,textarea,select,[contenteditable="true"],[role="combobox"]')].map(el =>
    el.matches('[contenteditable]') ? el.innerHTML : el.matches('[role="combobox"]') ? [el.getAttribute('aria-label'), el.textContent] : [el.name,el.type,el.value,el.checked,el.files?.length || 0]));
}

export function useFormDirty(open, panelRef, enabled) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDirty(false);
    if (!open || !enabled || !panelRef.current) return;
    const panel = panelRef.current;
    let baseline = snapshot(panel), touched = false;
    const check = () => { const next = snapshot(panel); if (!touched) baseline = next; else setDirty(next !== baseline); };
    const touch = event => {
      if (panel.contains(event.target) && event.target.closest('input,textarea,select,[contenteditable],[role="combobox"]')) touched = true;
    };
    const update = () => { touched = true; check(); };
    panel.addEventListener('pointerdown', touch, true);
    panel.addEventListener('keydown', touch, true);
    panel.addEventListener('input', update, true);
    panel.addEventListener('change', update, true);
    const observer = new MutationObserver(check);
    observer.observe(panel, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['value','checked','aria-selected'] });
    return () => { observer.disconnect(); panel.removeEventListener('pointerdown',touch,true); panel.removeEventListener('keydown',touch,true); panel.removeEventListener('input',update,true); panel.removeEventListener('change',update,true); };
  }, [open, enabled, panelRef]);
  return dirty;
}
