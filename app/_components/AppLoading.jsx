'use client';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';

/**
 * Spinner animado — reusa `.spinner` em globals.css; size/color só via style quando dinâmico.
 * @param {{ size?: number, color?: string, style?: object, className?: string }} props
 */
export function Spinner({ size = 14, color, style, className }) {
  const sizeOverride =
    size !== 14
      ? { width: size, height: size, minWidth: size, minHeight: size }
      : null;
  const colorOverride = color
    ? { color, borderColor: color, borderTopColor: 'transparent' }
    : null;
  const merged =
    sizeOverride || colorOverride || style
      ? { ...sizeOverride, ...colorOverride, ...style }
      : undefined;
  return (
    <span aria-hidden="true" className={cn('spinner', className)} style={merged} />
  );
}

/**
 * Short fade when panel content mounts (tab change, route, Suspense resolve).
 * Opacity-only — no CSS transform (Safari native <select> popups misalign under transform ancestors).
 * Honors prefers-reduced-motion via `.ui-content-enter` in globals.css.
 */
export function ContentEnter({ children, animKey, className }) {
  return (
    <div key={animKey} className={cn('ui-content-enter', className)}>
      {children}
    </div>
  );
}

/** Thin indeterminate bar while SSR/tab payload streams. */
export function NavLoadBar({ active = false }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-[40] h-0.5 overflow-hidden bg-brand-500/15"
      aria-hidden
    >
      <div className="ui-nav-indeterminate h-full w-1/3 bg-brand-500" />
    </div>
  );
}

/**
 * Panel placeholder: label + card/table bones (replaces spinner-only flash).
 */
export function PanelPageSkeleton({ locale = 'pt-BR', label }) {
  const text = label || t(locale, 'panel.common.loading');
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="ui-content-enter w-full min-h-[200px] space-y-4 py-2"
    >
      <div className="flex items-center gap-2 font-ui text-prose text-ink-muted">
        <Spinner size={16} className="text-brand-500" />
        <span>{text}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            aria-hidden="true"
            className="rounded-card border border-ink/10 bg-surface p-4"
          >
            <div className="mb-3 h-3 w-1/3 animate-pulse rounded-control bg-ink/[0.08]" />
            <div className="mb-2 h-4 w-3/4 animate-pulse rounded-control bg-ink/[0.1]" />
            <div className="h-3 w-1/2 animate-pulse rounded-control bg-ink/[0.07]" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="overflow-hidden rounded-card border border-ink/10 bg-surface">
        <div className="border-b border-ink/10 bg-ink/[0.03] px-4 py-3">
          <div className="flex gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-3 flex-1 animate-pulse rounded-control bg-ink/[0.08]"
              />
            ))}
          </div>
        </div>
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="border-b border-ink/[0.06] px-4 py-3.5 last:border-b-0"
          >
            <div className="flex gap-4">
              {[0, 1, 2, 3].map((col) => (
                <div
                  key={col}
                  className="h-3 flex-1 animate-pulse rounded-control bg-ink/[0.07]"
                  style={{ animationDelay: `${(row * 4 + col) * 40}ms` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading reutilizável (texto + spinner / skeleton de painel).
 * @param {{
 *   locale?: string,
 *   label?: string,
 *   variant?: 'inline'|'block'|'panel'|'button'|'banner',
 *   withSpinner?: boolean,
 * }} props
 */
export function AppLoading({
  locale = 'pt-BR',
  label,
  variant = 'inline',
  withSpinner = true,
}) {
  const text = label || t(locale, 'panel.common.loading');

  if (variant === 'panel') {
    return <PanelPageSkeleton locale={locale} label={text} />;
  }

  if (variant === 'banner') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="ui-content-enter mb-1 mt-2 flex items-center gap-2.5 rounded-control border border-brand-500/25 bg-brand-500/10 px-3 py-2.5 font-mono text-xs leading-snug text-brand-500"
      >
        {withSpinner ? <Spinner size={16} className="text-brand-500" /> : null}
        <span>{text}</span>
      </div>
    );
  }

  if (variant === 'block') {
    return (
      <p
        role="status"
        aria-live="polite"
        className="ui-content-enter mb-1 mt-2.5 flex items-center gap-2 font-mono text-xs text-ink-muted"
      >
        {withSpinner ? <Spinner size={14} className="text-brand-500" /> : null}
        {text}
      </p>
    );
  }

  if (variant === 'button') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 align-middle"
      >
        {withSpinner ? <Spinner size={14} className="text-brand-500" /> : null}
        <span>{text}</span>
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 font-mono text-prose text-ink-muted"
    >
      {withSpinner ? <Spinner size={14} className="text-brand-500" /> : null}
      {text}
    </span>
  );
}
