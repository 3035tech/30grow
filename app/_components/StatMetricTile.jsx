'use client';

import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';

/**
 * Metric tile: numeric value plus a readable supporting label.
 */
export function StatMetricTile({
  value,
  label,
  color = null,
  onClick = null,
  className = '',
  hero = false,
  hint = null,
  pressed = null,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick || undefined}
      aria-pressed={onClick && pressed != null ? Boolean(pressed) : undefined}
      className={cn(
        'rounded-control border border-ink/12 bg-ink/[0.02] px-3.5 py-3 text-left',
        onClick && 'min-h-touch cursor-pointer transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        pressed && 'ring-2 ring-brand-500/40',
        className
      )}
    >
      <div
        className={cn(hero ? S.cardMetricHero : S.cardMetricLg, 'text-ink')}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className={cn(S.cardMuted, 'mt-1')}>
        {label}
      </div>
      {hint ? (
        <div className={cn(S.cardMuted, 'mt-1.5')}>{hint}</div>
      ) : null}
    </Tag>
  );
}
