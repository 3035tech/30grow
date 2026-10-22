'use client';

import Link from 'next/link';
import { UI_TYPE } from '../../lib/ui-typography';
import { cn } from '../../lib/cn';

const actionClass =
  'inline-flex min-h-touch items-center justify-center rounded-control border border-brand-500/30 bg-brand-500/10 px-4 py-2 font-ui text-sm font-medium text-brand-600 no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35';

const secondaryActionClass =
  'inline-flex min-h-touch items-center justify-center rounded-control border border-ink/15 bg-transparent px-4 py-2 font-ui text-sm text-ink-muted no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35';

/**
 * Shared empty state for dashboard lists — one message + optional primary/secondary CTAs.
 */
export function EmptyState({
  title,
  message,
  description,
  actionLabel,
  onAction,
  actionHref,
  actionDisabled = false,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionHref,
  className,
}) {
  const showLink = Boolean(actionLabel && actionHref);
  const showButton = Boolean(actionLabel && typeof onAction === 'function' && !actionHref);
  const showSecondaryLink = Boolean(secondaryActionLabel && secondaryActionHref);
  const showSecondaryButton = Boolean(
    secondaryActionLabel && typeof onSecondaryAction === 'function' && !secondaryActionHref
  );
  const showActions = showLink || showButton || showSecondaryLink || showSecondaryButton;

  return (
    <div
      className={cn(
        'rounded-control border border-ink/12 bg-ink/[0.02] px-4 py-4 text-left',
        className
      )}
    >
      {title ? (
        <p className={cn("mb-1 mt-0", UI_TYPE.card)}>{title}</p>
      ) : null}
      {message || description ? (
        <p className={cn("my-0 max-w-[60ch]", UI_TYPE.supporting)}>
          {message || description}
        </p>
      ) : null}
      {showActions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showLink ? (
            <Link href={actionHref} className={actionClass}>
              {actionLabel}
            </Link>
          ) : null}
          {showButton ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={onAction}
              className={cn(actionClass, actionDisabled ? 'cursor-default opacity-55' : 'cursor-pointer')}
            >
              {actionLabel}
            </button>
          ) : null}
          {showSecondaryLink ? (
            <Link href={secondaryActionHref} className={secondaryActionClass}>
              {secondaryActionLabel}
            </Link>
          ) : null}
          {showSecondaryButton ? (
            <button
              type="button"
              onClick={onSecondaryAction}
              className={cn(secondaryActionClass, 'cursor-pointer')}
            >
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
