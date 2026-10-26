'use client';

import { useId } from 'react';

import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import {
  COMPANY_MODULE_CORE,
  COMPANY_MODULE_UI_GROUPS,
  SELECTABLE_COMPANY_MODULE_IDS,
} from '../../lib/company/company-modules';

/**
 * Checkbox list for company commercial modules (SKU entitlements).
 * Core is locked on. Visual groups only; storage keys stay flat.
 */
export function CompanyModulesField({
  locale,
  selectedIds,
  onChange,
  disabled = false,
  className = '',
  maxHeightClass = 'max-h-[280px]',
  showQuickActions = true,
}) {
  const fieldId = useId();
  const selected = new Set(selectedIds || []);
  const total = SELECTABLE_COMPANY_MODULE_IDS.length;
  const count = SELECTABLE_COMPANY_MODULE_IDS.filter((id) => selected.has(id)).length;
  const allOn = count === total;

  const toggle = (id) => {
    if (disabled || id === COMPANY_MODULE_CORE) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (!next.has(COMPANY_MODULE_CORE)) next.add(COMPANY_MODULE_CORE);
    onChange?.([...next]);
  };

  const selectAll = () => {
    if (disabled) return;
    onChange?.([...SELECTABLE_COMPANY_MODULE_IDS]);
  };

  const selectCoreOnly = () => {
    if (disabled) return;
    onChange?.([COMPANY_MODULE_CORE]);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-ink/10 bg-canvas/60 px-3 py-2.5">
        <div className="min-w-0" aria-live="polite">
          <p className="mb-0 font-ui text-sm font-medium text-ink">
            {allOn
              ? t(locale, 'onboarding.modules.allOn')
              : t(locale, 'onboarding.modules.selectedCount', { n: count, total })}
          </p>
          <p className={cn(S.faint, 'mb-0 mt-0.5')}>
            {t(locale, 'onboarding.modules.selectionImpact')}
          </p>
        </div>
        {showQuickActions ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={disabled || allOn}
              onClick={selectAll}
              className={cn(S.btnGhost, 'min-h-touch px-2.5 py-1.5 text-2xs')}
            >
              {t(locale, 'onboarding.modules.selectAll')}
            </button>
            <button
              type="button"
              disabled={disabled || (count === 1 && selected.has(COMPANY_MODULE_CORE))}
              onClick={selectCoreOnly}
              className={cn(S.btnGhost, 'min-h-touch px-2.5 py-1.5 text-2xs')}
            >
              {t(locale, 'onboarding.modules.coreOnly')}
            </button>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          maxHeightClass,
          'grid gap-3 overflow-y-auto rounded-card border border-ink/8 bg-ink/[0.02] p-3 sm:grid-cols-2'
        )}
        role="group"
        aria-label={t(locale, 'onboarding.modules.title')}
      >
        {COMPANY_MODULE_UI_GROUPS.map((group) => (
          <section key={group.id} className="min-w-0">
            <p className={cn(S.label, 'mb-1.5 px-0.5')}>
              {t(locale, `onboarding.modules.group.${group.id}`)}
            </p>
            <div className="overflow-hidden rounded-control border border-ink/10 bg-white divide-y divide-ink/8">
              {group.moduleIds.map((id) => {
                const locked = id === COMPANY_MODULE_CORE;
                const on = selected.has(id);
                const inputId = `${fieldId}-company-mod-${id}`;
                return (
                  <label
                    key={id}
                    htmlFor={inputId}
                    className={cn(
                      'flex min-h-touch items-start gap-3 border-l-2 px-3 py-2.5 transition-colors',
                      on
                        ? 'border-l-brand-500 bg-brand-500/[0.045]'
                        : 'border-l-transparent bg-white hover:bg-ink/[0.02]',
                      locked || disabled ? 'cursor-default opacity-90' : 'cursor-pointer'
                    )}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className={S.checkbox}
                      checked={on}
                      disabled={locked || disabled}
                      onChange={() => toggle(id)}
                    />
                    <span className="min-w-0">
                      <span className="block font-ui text-sm font-medium text-ink">
                        {t(locale, `onboarding.modules.item.${id}.title`)}
                        {locked ? (
                          <span className="ml-2 font-mono text-2xs font-normal text-ink-faint">
                            {t(locale, 'onboarding.modules.required')}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block font-ui text-xs text-ink-muted">
                        {t(locale, `onboarding.modules.item.${id}.body`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
