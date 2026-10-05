'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  dialogBtnPrimaryClass,
  dialogCardClass,
  dialogOverlayClass,
} from './app-dialog-styles';
import { Icon } from './Icon';

function noticeIconName(tone) {
  if (tone === 'error') return 'feedbackError';
  if (tone === 'warning') return 'feedbackWarning';
  if (tone === 'ok') return 'feedbackOk';
  return 'feedbackInfo';
}
/**
 * In-app notice dialog (replaces browser alert).
 * Portaled to document.body so the backdrop covers the full viewport.
 */
export function SystemNoticeModal({
  open,
  title,
  message,
  locale = 'pt-BR',
  tone = 'info',
  onClose,
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!mounted || !open || !message) return null;

  const heading = title || t(locale, 'panel.common.noticeTitle');
  const accentClass =
    tone === 'ok'
      ? 'text-success'
      : tone === 'error'
        ? 'text-danger'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-info';

  return createPortal(
    <div
      className={cn('app-dialog-overlay', dialogOverlayClass)}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-notice-title"
        className={dialogCardClass}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className={cn('mt-1 shrink-0', accentClass)} aria-hidden>
            <Icon name={noticeIconName(tone)} className="h-5 w-5 shrink-0" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="system-notice-title"
              className="m-0 font-ui text-xl font-semibold leading-tight text-ink"
            >
              {heading}
            </h2>
            <p className="mb-0 mt-3 whitespace-pre-line text-sm leading-[1.55] text-ink-muted">{message}</p>
          </div>
        </div>
        <div className="mt-[22px] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className={dialogBtnPrimaryClass}
          >
            {t(locale, 'panel.common.ok')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
