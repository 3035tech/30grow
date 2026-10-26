'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import {
  dialogBtnGhostClass,
  dialogBtnPrimaryClass,
  dialogOverlayElevatedClass,
} from './app-dialog-styles';
import { FormField } from './FormField';
import { DialogCloseButton } from './DialogCloseButton';
import {
  assertLogoSourceFile,
  clampLogoPan,
  coverScale,
  exportCroppedLogoFile,
  loadImageFromFile,
} from '../../lib/company/company-logo-client';
import { COMPANY_LOGO_MAX_EDGE } from '../../lib/company/company-logo-limits';

const VIEW = 280;

/**
 * Modal: 1:1 crop + client compress before logo upload.
 * @param {{ open: boolean, file: File|null, locale?: string, onCancel: () => void, onApply: (file: File) => void }} props
 */
export function CompanyLogoCropDialog({ open, file, locale = 'pt-BR', onCancel, onApply }) {
  const [mounted, setMounted] = useState(false);
  const [img, setImg] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dragRef = useRef(null);
  const revokeRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !file) {
      if (revokeRef.current) {
        revokeRef.current();
        revokeRef.current = null;
      }
      setImg(null);
      setPreviewUrl('');
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setError('');
      setBusy(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        assertLogoSourceFile(file);
        const loaded = await loadImageFromFile(file);
        if (cancelled) {
          loaded.revoke();
          return;
        }
        if (revokeRef.current) revokeRef.current();
        revokeRef.current = loaded.revoke;
        setImg(loaded.image);
        setPreviewUrl(loaded.objectUrl);
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setError('');
      } catch (e) {
        if (cancelled) return;
        const code = e?.code;
        if (code === 'INVALID_LOGO_SOURCE_SIZE') {
          setError(t(locale, 'panel.admin.companyLogoSourceTooLarge'));
        } else if (code === 'INVALID_LOGO_TYPE') {
          setError(t(locale, 'errors.INVALID_LOGO_TYPE'));
        } else {
          setError(e?.message || t(locale, 'panel.common.error'));
        }
        setImg(null);
        setPreviewUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file, locale]);

  useEffect(
    () => () => {
      if (revokeRef.current) {
        revokeRef.current();
        revokeRef.current = null;
      }
    },
    []
  );
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy, onCancel]);

  const applyPan = useCallback(
    (nx, ny) => {
      if (!img) return;
      const c = clampLogoPan(img.naturalWidth, img.naturalHeight, VIEW, zoom, nx, ny);
      setPan({ x: c.panX, y: c.panY });
    },
    [img, zoom]
  );

  const onZoomChange = (nextZoom) => {
    const z = Math.min(3, Math.max(1, Number(nextZoom) || 1));
    setZoom(z);
    if (!img) return;
    const c = clampLogoPan(img.naturalWidth, img.naturalHeight, VIEW, z, pan.x, pan.y);
    setPan({ x: c.panX, y: c.panY });
  };

  const onPointerDown = (e) => {
    if (!img || busy) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || !img) return;
    applyPan(d.panX + (e.clientX - d.x), d.panY + (e.clientY - d.y));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const handleApply = async () => {
    if (!img || busy) return;
    setBusy(true);
    setError('');
    try {
      const out = await exportCroppedLogoFile(img, {
        viewSize: VIEW,
        zoom,
        panX: pan.x,
        panY: pan.y,
        edge: COMPANY_LOGO_MAX_EDGE,
      });
      onApply?.(out);
    } catch (e) {
      setError(
        e?.code === 'INVALID_LOGO_SIZE'
          ? t(locale, 'errors.INVALID_LOGO_SIZE')
          : e?.message || t(locale, 'panel.common.error')
      );
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || !open) return null;

  const natW = img?.naturalWidth || 0;
  const natH = img?.naturalHeight || 0;
  const scale = img ? coverScale(natW, natH, VIEW) * zoom : 1;
  const drawnW = natW * scale;
  const drawnH = natH * scale;
  const left = (VIEW - drawnW) / 2 + pan.x;
  const top = (VIEW - drawnH) / 2 + pan.y;

  return createPortal(
    <div
      className={cn('app-dialog-overlay', dialogOverlayElevatedClass)}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-logo-crop-title"
        className="w-full max-w-[420px] rounded-card border border-ink/12 bg-white px-[26px] py-6 shadow-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="company-logo-crop-title" className="m-0 min-w-0 pt-1.5 font-display text-lg font-semibold text-ink">
            {t(locale, 'panel.admin.companyLogoCropTitle')}
          </h2>
          <DialogCloseButton onClick={() => onCancel?.()} locale={locale} disabled={busy} className="-mr-2 -mt-1" />
        </div>
        <p className="mb-4 mt-2 text-sm leading-snug text-ink-muted">
          {t(locale, 'panel.admin.companyLogoCropHint')}
        </p>

        <div
          className="relative mx-auto overflow-hidden rounded-xl border border-ink/15 bg-ink/[0.06]"
          style={{ width: VIEW, height: VIEW, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img && previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                width: drawnW,
                height: drawnH,
                left,
                top,
                cursor: busy ? 'default' : 'grab',
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-ink-faint">
              {error ? '—' : t(locale, 'panel.common.loading')}
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-brand-500/40"
            aria-hidden
          />
        </div>

        <FormField
          label={t(locale, 'panel.admin.companyLogoCropZoom')}
          className="mt-4"
        >
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            disabled={!img || busy}
            onChange={(e) => onZoomChange(e.target.value)}
            className="w-full accent-brand-500"
          />
        </FormField>

        {error ? <p className="mb-0 mt-3 text-xs text-danger">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={dialogBtnGhostClass}
            disabled={busy}
            onClick={() => onCancel?.()}
          >
            {t(locale, 'panel.common.cancel')}
          </button>
          <button
            type="button"
            className={cn(dialogBtnPrimaryClass, 'min-h-touch')}
            disabled={!img || busy}
            onClick={() => void handleApply()}
          >
            {busy
              ? t(locale, 'panel.admin.companyLogoCropWorking')
              : t(locale, 'panel.admin.companyLogoCropApply')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
