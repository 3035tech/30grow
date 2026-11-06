'use client';

import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { Icon } from './Icon';
import { IconActionTip } from './IconActionTip';

const TINT = {
  brand: 'border-line bg-surface text-brand-700 hover:border-brand-500/40 hover:bg-brand-500/[0.08]',
  muted: 'border-line bg-surface text-ink-muted hover:bg-ink/[0.05] hover:text-ink',
  danger: 'border-line bg-surface text-danger hover:border-danger/40 hover:bg-danger/[0.08]',
};

/** Compact secondary action for collaborator lists. The label remains available to screen readers and on hover/focus. */
export function EmployeeIconButton({
  label,
  mobileLabel,
  icon,
  onClick,
  disabled = false,
  busy = false,
  tint = 'muted',
  className,
  buttonRef,
  ariaExpanded,
  ariaControls,
}) {
  return (
    <IconActionTip label={label}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-busy={busy || undefined}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        title={label}
        className={cn(
          S.btnRowIcon,
          mobileLabel && 'w-auto gap-2 px-3 sm:min-w-touch sm:px-0',
          TINT[tint] || TINT.muted,
          className
        )}
      >
        <Icon name={icon} />
        {mobileLabel ? <span className="text-sm sm:sr-only">{mobileLabel}</span> : null}
      </button>
    </IconActionTip>
  );
}
