'use client';

import { dialogCheckboxClass } from './app-dialog-styles';
import { cn } from '../../lib/cn';

const BULK_ACTION = 'min-h-touch rounded-control px-2 font-ui text-sm text-brand-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-default disabled:opacity-45 disabled:no-underline';

export function CheckboxGroupControl({ label, options, value = [], onChange, selectAllLabel, clearAllLabel, selectionSummary, emptySelectionLabel }) {
  return <div role="group" aria-label={label}>
    {selectAllLabel && clearAllLabel ? <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" className={BULK_ACTION} disabled={options.every(option => value.includes(option.value))} onClick={() => onChange(options.map(option => option.value))}>{selectAllLabel}</button>
      <button type="button" className={BULK_ACTION} disabled={value.length === 0} onClick={() => onChange([])}>{clearAllLabel}</button>
    </div> : null}
    <div className="prompt-checkbox-grid mt-2 grid max-h-[220px] grid-cols-1 gap-1 overflow-y-auto rounded-control border border-ink/12 bg-ink/[0.03] p-2 sm:grid-cols-2">
      {options.map(option => <label key={option.value} className={cn('flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-2 font-ui text-sm text-ink transition-colors hover:bg-ink/[0.04]', value.includes(option.value) && 'bg-brand-500/[0.07]')}>
        <input type="checkbox" checked={value.includes(option.value)} onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(item => item !== option.value))} className={dialogCheckboxClass} />
        {option.label}
      </label>)}
    </div>
    {selectionSummary ? <p role="status" aria-live="polite" aria-atomic="true" className="mb-0 mt-2 font-ui text-sm text-ink-muted">
      {selectionSummary(value.length, options.length)}
      {value.length === 0 && emptySelectionLabel ? <span className="mt-1 block">{emptySelectionLabel}</span> : null}
    </p> : null}
  </div>;
}
