'use client';

import Link from 'next/link';
import { BrandMark } from './BrandMark';
import LanguageSelect from './LanguageSelect';
import { cn } from '../../lib/cn';

export function PrimaryCta({ copy, compact = false }) {
  return <Link href="/signup" className={`inline-flex min-h-touch items-center justify-center rounded-control bg-action font-ui font-semibold text-action-ink no-underline transition-colors hover:bg-action-hover ${compact ? 'px-3 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm' : 'px-6 py-3.5 text-base'}`}>{compact ? copy.navEarly : copy.ctaEarly}</Link>;
}

/**
 * Public marketing header shared by `/` and `/pricing`.
 * `sectionBase` prefixes landing anchors ('' on the landing, '/' elsewhere).
 */
export function PublicSiteHeader({ copy, locale, onLocaleChange, sectionBase = '', active = null }) {
  const u = copy.ui;
  const linkClass = (isActive) => cn('whitespace-nowrap text-sm no-underline hover:text-ink', isActive ? 'font-semibold text-ink' : 'text-ink-muted');
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <Link href="/" className="inline-flex items-center no-underline" aria-label="30Grow">
          <BrandMark size={30} withWordmark className="brand-mark--responsive" />
        </Link>
        <nav className="hidden items-center gap-3 lg:flex xl:gap-6" aria-label={u.mainNavigation}>
          <a href={`${sectionBase}#como-funciona`} className={linkClass(false)}>{u.navJourney}</a>
          <a href={`${sectionBase}#modulos`} className={linkClass(false)}>{u.navModules}</a>
          <a href={`${sectionBase}#app-colaborador`} className={linkClass(false)}>{copy.employeeApp.label}</a>
          <Link href="/pricing" className={linkClass(active === 'pricing')} aria-current={active === 'pricing' ? 'page' : undefined}>{u.navPricing}</Link>
          <a href={`${sectionBase}#faq`} className={linkClass(false)}>FAQ</a>
        </nav>
        <div className="flex items-center gap-2 [&>label>span]:hidden">
          <LanguageSelect locale={locale} onChange={onLocaleChange} compact />
          <Link href="/login" className="hidden min-h-touch items-center whitespace-nowrap px-2 text-sm text-ink-muted no-underline hover:text-ink sm:inline-flex xl:px-3">{copy.navLogin}</Link>
          <div className="hidden sm:block"><PrimaryCta copy={copy} compact /></div>
        </div>
      </div>
    </header>
  );
}
