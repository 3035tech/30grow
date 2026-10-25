'use client';

export function CheckboxGroupControl({ label, options, value = [], onChange, selectAllLabel, clearAllLabel }) {
  return <div role="group" aria-label={label}>
    {selectAllLabel && clearAllLabel ? <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" className="min-h-touch rounded-control px-2 text-sm text-brand-600 underline-offset-2 hover:underline" disabled={value.length === options.length} onClick={() => onChange(options.map(option => option.value))}>{selectAllLabel}</button>
      <button type="button" className="min-h-touch rounded-control px-2 text-sm text-brand-600 underline-offset-2 hover:underline" disabled={value.length === 0} onClick={() => onChange([])}>{clearAllLabel}</button>
    </div> : null}
    <div className="prompt-checkbox-grid mt-2 grid max-h-[220px] grid-cols-1 gap-x-3 gap-y-2 overflow-y-auto rounded-control border border-ink/12 bg-ink/[0.03] px-3 py-2.5 sm:grid-cols-2">
      {options.map(option => <label key={option.value} className="flex min-h-touch cursor-pointer items-center gap-2 font-ui text-sm text-ink">
        <input type="checkbox" checked={value.includes(option.value)} onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(item => item !== option.value))} className="h-4 w-4 shrink-0 accent-brand-500" />
        {option.label}
      </label>)}
    </div>
  </div>;
}
