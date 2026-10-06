import Link from 'next/link';
import { BrandMark } from '../_components/BrandMark';
import { PublicSiteHeaderWithLocale } from '../_components/PublicSiteHeader';
import { ContentEnter } from '../_components/AppLoading';
import { LOCALES } from '../../lib/i18n';
import { getProductLandingCopy, getPublicHeaderCopy } from '../../lib/product-landing-seo';
import { t } from '../../lib/i18n';
import { BLOG_CONTENT_LOCALE } from '../../lib/blog/index.js';

/** Public chrome for `/blog` pages: landing header/footer, content in pt-BR. */
export function BlogShell({ locale, children }) {
  const headerCopyByLocale = Object.fromEntries(LOCALES.map((loc) => [loc, getPublicHeaderCopy(loc)]));
  const copy = getProductLandingCopy(locale);
  return (
    <div className="min-h-screen bg-canvas font-ui text-ink">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2">{copy.skipToContent}</a>
      <PublicSiteHeaderWithLocale initialLocale={locale} copyByLocale={headerCopyByLocale} active="blog" />
      <ContentEnter>
        <main id="conteudo" lang={BLOG_CONTENT_LOCALE} className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
          {children}
        </main>
      </ContentEnter>
      <footer className="border-t border-ink/8 bg-surface py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <BrandMark size={26} withWordmark />
            <p className="mb-0 mt-2 max-w-xl text-xs leading-5 text-ink-faint">{copy.footerLegal}</p>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm" aria-label={copy.ui.mainNavigation}>
            <Link href="/" className="text-ink-muted no-underline hover:text-ink">30Grow</Link>
            <Link href="/blog" className="text-ink-muted no-underline hover:text-ink">{copy.ui.navBlog}</Link>
            <Link href="/pricing" className="text-ink-muted no-underline hover:text-ink">{copy.footerPricing}</Link>
            <Link href="/privacy" className="text-ink-muted no-underline hover:text-ink">{copy.footerPrivacy}</Link>
            <Link href="/terms" className="text-ink-muted no-underline hover:text-ink">{copy.footerTerms}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Breadcrumb trail; the last item is the current page. */
export function BlogBreadcrumb({ locale, items }) {
  const trail = [{ href: '/', label: t(locale, 'blog.home') }, ...items];
  return (
    <nav aria-label={t(locale, 'blog.breadcrumbAria')} className="mb-6 font-ui text-xs text-ink-faint">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0">
        {trail.map((item, index) => (
          <li key={item.label} className="inline-flex items-center gap-2">
            {index > 0 ? <span aria-hidden>/</span> : null}
            {index < trail.length - 1
              ? <Link href={item.href} className="text-ink-muted no-underline hover:text-ink">{item.label}</Link>
              : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
