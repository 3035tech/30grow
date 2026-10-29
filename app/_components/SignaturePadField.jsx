'use client';

import { useEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { t } from '../../lib/i18n';
import { Icon } from './Icon';

/**
 * Compact preview of a stored signature stroke (PNG data URL).
 */
export function SignatureStrokePreview({
  src,
  alt = '',
  caption = '',
  className = '',
  maxHeightClass = 'max-h-32',
}) {
  if (!src) return null;
  return (
    <figure
      className={cn(
        'mt-2 overflow-hidden rounded-control border border-ink/10 bg-white',
        className
      )}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          'block h-auto w-auto max-w-full object-contain object-left px-2.5 py-2',
          maxHeightClass
        )}
      />
      {caption ? (
        <figcaption className="border-t border-ink/8 bg-canvas/50 px-2.5 py-1 font-mono text-2xs text-ink-faint">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Pointer-friendly signature pad (mouse / touch / stylus) via `signature_pad`.
 * Ref API: clear(), undo(), isEmpty(), toDataURL(), focus().
 */
export function SignaturePadField({
  locale = 'pt-BR',
  className = '',
  height = 180,
  disabled = false,
  padRef = null,
  onEmptyChange = null,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const padInstanceRef = useRef(null);
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;
  const [empty, setEmpty] = useState(true);
  const [strokeCount, setStrokeCount] = useState(0);

  const syncFromPad = (pad) => {
    if (!pad) return;
    const nextEmpty = pad.isEmpty();
    setEmpty(nextEmpty);
    setStrokeCount(pad.toData()?.length || 0);
    onEmptyChangeRef.current?.(nextEmpty);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: 'rgb(15, 23, 42)',
      minWidth: 0.7,
      maxWidth: 2.4,
      velocityFilterWeight: 0.7,
      throttle: 16,
    });
    padInstanceRef.current = pad;

    const onEnd = () => syncFromPad(pad);
    const onBegin = () => {
      setEmpty(false);
      onEmptyChangeRef.current?.(false);
    };
    pad.addEventListener('endStroke', onEnd);
    pad.addEventListener('beginStroke', onBegin);

    let raf = 0;
    const resize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const rect = wrap.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width));
        const h = Math.max(1, Math.floor(height));
        const data = pad.isEmpty() ? null : pad.toData();
        canvas.width = w * ratio;
        canvas.height = h * ratio;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        pad.clear();
        if (data?.length) pad.fromData(data);
        syncFromPad(pad);
      });
    };

    resize();
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => resize())
      : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);

    if (padRef) {
      padRef.current = {
        clear: () => {
          pad.clear();
          syncFromPad(pad);
        },
        undo: () => {
          const data = pad.toData();
          if (!data?.length) return;
          data.pop();
          pad.fromData(data);
          syncFromPad(pad);
        },
        isEmpty: () => pad.isEmpty(),
        toDataURL: (type = 'image/png', encoderOptions) =>
          pad.toDataURL(type, encoderOptions),
        focus: () => canvas.focus({ preventScroll: true }),
      };
    }

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      pad.off();
      padInstanceRef.current = null;
      if (padRef) padRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable padRef from parent
  }, [height]);

  useEffect(() => {
    const pad = padInstanceRef.current;
    if (!pad) return;
    if (disabled) pad.off();
    else pad.on();
  }, [disabled]);

  const guideBottom = Math.max(40, Math.round(height * 0.3));

  const undoStroke = () => {
    const pad = padInstanceRef.current;
    if (!pad) return;
    const data = pad.toData();
    if (!data?.length) return;
    data.pop();
    pad.fromData(data);
    syncFromPad(pad);
  };

  const clearPad = () => {
    const pad = padInstanceRef.current;
    if (!pad) return;
    pad.clear();
    syncFromPad(pad);
  };

  return (
    <div className={cn('w-full', className)}>
      <div
        ref={wrapRef}
        className={cn(
          'relative overflow-hidden rounded-control border bg-white',
          'border-ink/15 shadow-sm',
          'focus-within:border-brand-500/50 focus-within:ring-2 focus-within:ring-brand-500/20',
          !empty && 'border-success/35',
          disabled && 'pointer-events-none opacity-60'
        )}
      >
        <canvas
          ref={canvasRef}
          className="relative z-[1] block w-full touch-none cursor-crosshair"
          style={{ height }}
          tabIndex={disabled ? -1 : 0}
          aria-label={t(locale, 'panel.dp.sigPadAria')}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-5 z-[2] border-b border-dashed border-ink/20"
          style={{ bottom: guideBottom }}
        />
        {empty ? (
          <p
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center px-4 text-center font-mono text-prose text-ink-faint"
          >
            {t(locale, 'panel.dp.sigPadEmpty')}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            'm-0 font-mono text-2xs',
            empty ? 'text-ink-faint' : 'text-success'
          )}
          aria-live="polite"
        >
          {empty
            ? t(locale, 'panel.dp.sigPadHintStatus')
            : t(locale, 'panel.dp.sigPadDrawn')}
        </p>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch px-2 text-2xs')}
            disabled={disabled || strokeCount < 1}
            onClick={undoStroke}
          >
            {t(locale, 'panel.dp.sigPadUndo')}
          </button>
          <button
            type="button"
            className={cn(S.btnGhost, 'inline-flex min-h-touch items-center gap-1.5 px-2 text-2xs')}
            disabled={disabled || empty}
            onClick={clearPad}
            aria-label={t(locale, 'panel.dp.sigPadClear')}
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
            {t(locale, 'panel.dp.sigPadClear')}
          </button>
        </div>
      </div>
    </div>
  );
}
