'use client';

import { cn } from '../../lib/cn';

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Slider for short closed ranges (%, 0–10 weights, minutes) with the value beside it,
 * editable for an exact number. `value` / `onChange` use strings, same payload as a
 * number input. Typed values are clamped on blur, not per keystroke (typing "50" in 10–100
 * would otherwise jump to 10 at the "5"). Empty stays empty so `required` still applies.
 */
export function RangeField({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  minLabel,
  midLabel,
  maxLabel,
  label,
  disabled = false,
  hideScale = false,
  className,
}) {
  const safeStep = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 1;
  const raw = value == null ? '' : String(value);
  const parsed = Number(raw);
  const hasValue = raw.trim() !== '' && Number.isFinite(parsed);
  const sliderValue = hasValue ? clamp(parsed, min, max) : min;

  const commitTyped = () => {
    if (!hasValue) return;
    const next = clamp(parsed, min, max);
    if (next !== parsed) onChange(String(next));
  };

  return (
    <div className={cn('mt-1', className)}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={safeStep}
          value={sliderValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="ui-range min-w-0 flex-1"
          aria-label={label}
        />
        <span className="inline-flex shrink-0 items-center rounded-control bg-canvas-alt pr-2 focus-within:outline focus-within:outline-2 focus-within:outline-brand-500">
          <input
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={safeStep}
            value={raw}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onBlur={commitTyped}
            className="min-h-touch w-16 border-0 bg-transparent px-2 text-right font-mono text-sm tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label={label}
          />
          {suffix ? <span className="font-mono text-sm text-ink-muted">{suffix}</span> : null}
        </span>
      </div>
      {hideScale ? null : (
        <div className="mt-0.5 flex justify-between font-mono text-2xs text-ink-muted">
          <span>{minLabel != null ? minLabel : `${min}${suffix}`}</span>
          {midLabel ? <span>{midLabel}</span> : null}
          <span>{maxLabel != null ? maxLabel : `${max}${suffix}`}</span>
        </div>
      )}
    </div>
  );
}
