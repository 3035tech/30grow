'use client';

import Link from 'next/link';
import { BrandMark } from './BrandMark';
import LanguageSelect from './LanguageSelect';
import { cn } from '../../lib/cn';
import { LOCALE_COOKIE, normalizeLocale } from '../../lib/i18n';
import { useLocale } from '../../lib/useLocale';
import { publicBlogPath, publicMarketingPath, publicMarketingRoute } from '../../lib/marketing/public-marketing-paths';
import { PRODUCT_LANDING_WHATSAPP_URL } from '../../lib/marketing/brand-entity';

export function PrimaryCta({ copy, compact = false }) {
  return <Link href="/signup" className={`inline-flex min-h-touch items-center justify-center rounded-control bg-action font-ui font-semibold text-action-ink no-underline transition-colors hover:bg-action-hover ${compact ? 'px-3 py-2 text-xs sm:px-4 sm:py-2.5 sm:text-sm' : 'px-6 py-3.5 text-base'}`}>{compact ? copy.navEarly : copy.ctaEarly}</Link>;
}

/**
 * Public marketing header shared by `/`, `/pricing` and `/blog`.
 * `sectionBase` prefixes landing anchors ('' on the landing, '/' elsewhere).
 */
export function PublicSiteHeader({ copy, locale, onLocaleChange, sectionBase = '', active = null }) {
  const u = copy.ui;
  const homePath = publicMarketingPath(locale);
  const anchorBase = sectionBase ? homePath : '';
  const switchLanguage = (next) => {
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(normalizeLocale(next))}; path=/; max-age=31536000; samesite=lax`;
    const route = publicMarketingRoute(window.location.pathname);
    if (route || window.location.pathname === '/blog' || window.location.pathname.startsWith('/blog/')) {
      const targetPath = route
        ? publicMarketingPath(next, route.page, route.solutionIndex)
        : publicBlogPath(next, window.location.pathname.slice('/blog/'.length).replace(/\/$/, ''));
      const target = new URL(targetPath, window.location.origin);
      target.search = window.location.search;
      if (route || normalizeLocale(next) === 'pt-BR') target.searchParams.delete('lang');
      else target.searchParams.set('lang', normalizeLocale(next));
      target.hash = window.location.hash;
      window.location.assign(target.href);
      return;
    }
    onLocaleChange?.(next);
  };
  const linkClass = (isActive) => cn('whitespace-nowrap text-sm no-underline hover:text-ink', isActive ? 'font-semibold text-ink' : 'text-ink-muted');
  return (
    <>
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <Link href={homePath} className="inline-flex items-center no-underline" aria-label="30Grow">
          <BrandMark size={30} withWordmark className="brand-mark--responsive" />
        </Link>
        <nav className="hidden items-center gap-3 lg:flex xl:gap-6" aria-label={u.mainNavigation}>
          <a href={`${anchorBase}#como-funciona`} className={linkClass(false)}>{u.navJourney}</a>
          <a href={`${anchorBase}#modulos`} className={linkClass(false)}>{u.navModules}</a>
          <a href={`${anchorBase}#app-colaborador`} className={linkClass(false)}>{copy.employeeApp.label}</a>
          <Link href={publicMarketingPath(locale, '/pricing')} className={linkClass(active === 'pricing')} aria-current={active === 'pricing' ? 'page' : undefined}>{u.navPricing}</Link>
          <Link href={publicBlogPath(locale)} className={linkClass(active === 'blog')} aria-current={active === 'blog' ? 'page' : undefined}>{u.navBlog || 'Blog'}</Link>
          <a href={`${anchorBase}#faq`} className={linkClass(false)}>FAQ</a>
        </nav>
        <div className="flex items-center gap-2 [&>label>span]:hidden">
          <LanguageSelect locale={locale} onChange={switchLanguage} compact />
          <Link href="/login" className="hidden min-h-touch items-center whitespace-nowrap px-2 text-sm text-ink-muted no-underline hover:text-ink sm:inline-flex xl:px-3">{copy.navLogin}</Link>
          <div className="hidden sm:block"><PrimaryCta copy={copy} compact /></div>
        </div>
      </div>
    </header>
    <a
      href={PRODUCT_LANDING_WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="WhatsApp 30Grow"
      title="WhatsApp 30Grow"
      className="fixed bottom-5 right-5 z-[60] inline-flex min-h-[52px] min-w-[52px] items-center justify-center gap-2 rounded-full bg-[#128C7E] px-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#075E54] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:bottom-6 sm:right-6"
    >
      <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0 fill-current" aria-hidden="true">
        <path d="M16.03 3.2A12.73 12.73 0 0 0 5.1 22.47L3.4 28.7l6.37-1.67a12.75 12.75 0 1 0 6.26-23.83Zm0 23.17c-1.9 0-3.76-.5-5.4-1.44l-.39-.23-3.78.99 1.01-3.68-.25-.4a10.38 10.38 0 1 1 8.81 4.76Zm5.7-7.77c-.31-.16-1.83-.9-2.12-1-.28-.1-.49-.16-.69.16-.2.31-.79 1-.97 1.2-.18.2-.36.23-.67.08-.31-.16-1.3-.48-2.48-1.52-.92-.82-1.54-1.83-1.72-2.14-.18-.31-.02-.48.14-.64.14-.14.31-.36.46-.54.16-.18.2-.31.31-.52.1-.2.05-.39-.03-.54-.08-.16-.69-1.66-.95-2.27-.25-.6-.51-.52-.69-.53h-.59c-.2 0-.54.08-.82.39-.28.31-1.08 1.05-1.08 2.55 0 1.51 1.1 2.96 1.25 3.16.16.2 2.16 3.3 5.23 4.63.73.31 1.3.5 1.75.64.74.24 1.41.2 1.94.12.59-.09 1.83-.75 2.09-1.47.26-.73.26-1.35.18-1.48-.08-.13-.28-.2-.59-.36Z" />
      </svg>
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
    </>
  );
}

/** Header for server-rendered public pages: owns the locale switch (cookie + catalog). */
export function PublicSiteHeaderWithLocale({ initialLocale, copyByLocale, active = null }) {
  const [locale, setLocale] = useLocale(initialLocale);
  const copy = copyByLocale[normalizeLocale(locale)] || copyByLocale['pt-BR'];
  return <PublicSiteHeader copy={copy} locale={locale} onLocaleChange={setLocale} sectionBase="/" active={active} />;
}

