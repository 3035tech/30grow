'use client';

import { cn } from '../../lib/cn';
import { Icon } from './Icon';

/**
 * Compact segmented control (list/kanban, filter modes).
 * Prefer PanelSubNav for full tab strips.
 *
 * @param {{ id: string, label: string, icon?: string }[]} options
 */
export function SegmentedControl({
  options = [],
  value,
  onChange,
  className = '',
  size = 'md',
  'aria-label': ariaLabel,
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-control border border-ink/12 bg-ink/[0.02] p-1',
        className
      )}
    >
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange?.(opt.id)}
            className={cn(
              'inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-control border font-ui disabled:opacity-55',
              size === 'sm' ? 'px-2.5 py-1.5 text-prose' : 'px-3 py-2 text-xs',
              on
                ? 'border-brand-500/35 bg-brand-500/10 text-brand-600'
                : 'border-transparent bg-transparent text-ink-muted hover:bg-ink/[0.04]'
            )}
          >
            {opt.icon ? <Icon name={opt.icon} className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
