'use client';

import { SelectField } from './SelectField';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { fieldSelectCompactClass } from './form-control-styles';
import { FormField } from './FormField';
import { ContentEnter } from './AppLoading';

const clearBtnClass =
  'inline-flex min-h-touch shrink-0 cursor-pointer items-center justify-center rounded-control border border-ink/12 bg-transparent px-3.5 py-2.5 font-ui text-sm text-ink-muted transition-colors hover:border-ink/20 hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/35 disabled:cursor-default disabled:opacity-45';

/**
 * Single-row filter bar for admin listagens.
 * Children: AdminListSearch + AdminListFilterSelect only — never AdminCreateButton.
 * Optional `onClear` renders “Limpar filtros” at the end (standard; no Buscar button).
 * Search submits on Enter when AdminListSearch has onSubmit; filtering is live via onChange.
 */
export function AdminListFilters({
  children,
  className = '',
  'aria-label': ariaLabel,
  locale = 'pt-BR',
  onClear,
  clearEnabled = false,
}) {
  return (
    <div
      role="search"
      aria-label={ariaLabel || t(locale, 'panel.common.filters')}
      className={cn(
        'ui-list-filters mb-3 flex max-w-full flex-wrap items-end gap-2.5 rounded-control border border-ink/8 bg-ink/[0.015] p-3',
        className
      )}
    >
      {children}
      {typeof onClear === 'function' ? (
        <button
          type="button"
          onClick={onClear}
          disabled={!clearEnabled}
          className={clearBtnClass}
        >
          {t(locale, 'panel.common.clearFilters')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Compact select filter for a listing column (label above via FormField).
 */
export function AdminListFilterSelect({
  label,
  value,
  onChange,
  children,
  className = '',
  selectClassName = '',
  disabled = false,
}) {
  return (
    <FormField label={label} className={cn('min-w-[9.5rem] max-w-[14rem] shrink-0', className)}>
      <SelectField
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={label}
        className={cn(fieldSelectCompactClass, 'w-full min-w-[9.5rem]', selectClassName)}
      >
        {children}
      </SelectField>
    </FormField>
  );
}

/**
 * Wraps list results (table / empty / pager block) so filter changes re-trigger ContentEnter.
 */
export function AdminListResults({ animKey, children, className = '' }) {
  if (animKey === undefined || animKey === null || animKey === '') {
    return <div className={className}>{children}</div>;
  }
  return (
    <ContentEnter animKey={String(animKey)} className={cn('w-full', className)}>
      {children}
    </ContentEnter>
  );
}
