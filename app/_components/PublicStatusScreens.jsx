'use client';

import { brandMarkSrc } from '../../lib/marketing/brand';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';

/**
 * Branded loading moment (CSS animation on logo — sharper than a GIF).
 * @param {{ locale?: string, label?: string, fullPage?: boolean }} props
 */
export function BrandPulseLoading({ locale = 'pt-BR', label, fullPage = false }) {
  const text = label || t(locale, 'panel.common.loading');

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex flex-col items-center justify-center gap-[18px] text-center',
        fullPage ? 'min-h-[50vh] px-5 py-12' : 'px-4 py-7'
      )}
    >
      <div className="brand-pulse-ring" aria-hidden>
        <img
          src={brandMarkSrc(128)}
          alt=""
          width={72}
          height={72}
          className="brand-pulse-mark block"
        />
      </div>
      <p className="m-0 max-w-[280px] font-display text-base leading-[1.45] text-ink-muted">
        {text}
      </p>
    </div>
  );
}

/**
 * Friendly broken-but-fixing status for public routes (/r, etc.).
 * @param {{
 *   locale?: string,
 *   title?: string,
 *   message?: string,
 *   onRetry?: () => void,
 * }} props
 */
export function PublicFunnyError({ locale = 'pt-BR', title, message, onRetry }) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center gap-4 px-5 pb-12 pt-8 text-center">
      <img
        src="/brand/status-broken-fixing.png"
        alt=""
        width={220}
        height={220}
        className="block h-auto w-[min(220px,70vw)] rounded-card"
      />
      <p className="m-0 font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-brand-500">
        30Grow
      </p>
      <h1 className="m-0 font-display text-[clamp(22px,5vw,28px)] font-semibold leading-[1.25] text-ink">
        {title || t(locale, 'panel.report.funnyErrorTitle')}
      </h1>
      <p className="m-0 text-sm leading-[1.55] text-ink-muted">
        {message || t(locale, 'panel.report.funnyErrorBody')}
      </p>
      {typeof onRetry === 'function' ? (
        <button type="button" onClick={onRetry} className={cn(S.btnBrandSoft, 'mt-2')}>
          {t(locale, 'panel.report.funnyErrorRetry')}
        </button>
      ) : null}
    </div>
  );
}
