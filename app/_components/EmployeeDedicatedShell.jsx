'use client';

import Link from 'next/link';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { AppLoading } from './AppLoading';

/**
 * Shared chrome for heavy collaborator modules (back + title + body).
 * Parent EmployeeShell already wraps with ContentEnter.
 */
export function EmployeeDedicatedShell({
  locale = 'pt-BR',
  title,
  hint = null,
  children,
  maxWidthClass = 'max-w-6xl',
  trailing = null,
  backHref = '/employee',
  backLabel = null,
  onBack = null,
  headingId = undefined,
  headerContent = null,
  showHeader = true,
}) {
  return (
    <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8', maxWidthClass)}>
      {showHeader ? <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
        <div className="min-w-0 flex-1 basis-64">
          {onBack ? (
            <button type="button" onClick={onBack} className={cn(S.btnGhost, 'no-underline')}>
              ← {backLabel || t(locale, 'employeeHome.backHome')}
            </button>
          ) : (
            <Link href={backHref} className={cn(S.btnGhost, 'no-underline')}>
              ← {backLabel || t(locale, 'employeeHome.backHome')}
            </Link>
          )}
          <h1 id={headingId} tabIndex={-1} className={cn(S.pageTitle, 'mt-4 mb-2 break-words focus-visible:outline-brand-500 focus-visible:outline-offset-4')}>{title}</h1>
          {hint ? <p className={cn(S.muted, 'mb-0 max-w-[65ch] leading-relaxed')}>{hint}</p> : null}
          {headerContent}
        </div>
        {trailing ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{trailing}</div> : null}
      </div> : null}
      {children}
    </div>
  );
}

/**
 * Panel skeleton inside the same container as collaborator pages, so content does not jump on load.
 * With `titleKey`, keeps back link + title visible while data loads. Keys (not strings) because
 * Suspense fallbacks render before I18nBoot; a missing catalog falls back to the bare skeleton.
 */
export function EmployeePageLoading({ locale = 'pt-BR', titleKey = '', hintKey = '' }) {
  const title = titleKey ? t(locale, titleKey) : '';
  if (title && title !== titleKey) {
    const hint = hintKey ? t(locale, hintKey) : '';
    return (
      <EmployeeDedicatedShell locale={locale} title={title} hint={hint && hint !== hintKey ? hint : null}>
        <AppLoading variant="panel" locale={locale} />
      </EmployeeDedicatedShell>
    );
  }
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <AppLoading variant="panel" locale={locale} />
    </div>
  );
}
