'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
  dialogBtnSolidClass,
  dialogCardClass,
  dialogOverlayClass,
} from './app-dialog-styles';

/**
 * Confirm / cancel dialog (replaces window.confirm).
 * @param {{ open: boolean, title?: string, message: string, locale?: string, danger?: boolean, confirmLabel?: string, cancelLabel?: string, onConfirm: () => void, onCancel: () => void }} props
 */
export function ConfirmDialog({
  open,
  title,
  message,
  locale = 'pt-BR',
  danger = false,
  preferCancel = false,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) {
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onCancel]);

  if (!mounted || !open || !message) return null;

  const heading = title || t(locale, 'panel.common.confirmTitle');

  return createPortal(
    <div
      className={cn('app-dialog-overlay', dialogOverlayClass)}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel?.();
            return;
          }
          if (event.key !== 'Tab') return;
          const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
          const first = buttons[0], last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className={dialogCardClass}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="m-0 font-ui text-xl font-semibold leading-snug text-ink"
        >
          {heading}
        </h2>
        <p id={messageId} className="mb-0 mt-3 max-h-[50vh] overflow-y-auto whitespace-pre-line break-words text-sm leading-[1.55] text-ink-muted">{message}</p>
        <div className="mt-[22px] flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} autoFocus={preferCancel} className={dialogBtnGhostClass}>
            {cancelLabel || t(locale, 'panel.common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus={!preferCancel}
            className={danger ? cn(dialogBtnSolidClass, 'bg-danger') : dialogBtnPrimaryClass}
          >
            {confirmLabel || t(locale, 'panel.common.confirmAction')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
