'use client';

import Link from 'next/link';
import { publicMarketingPath } from '../../lib/public-marketing-paths';
import { PublicLanguageLinks } from './PublicLanguageLinks';
import { PublicSiteHeader } from './PublicSiteHeader';
import { useLocale } from '../../lib/useLocale';
import { localeHtmlLang, normalizeLocale, t } from '../../lib/i18n';
import { formatPublicPrice, getPublicPricing, publicPricingTextValues } from '../../lib/pricing-currency';
import { getPricingCoreFeatures } from '../../lib/pricing-plans';

export default function PricingPageClient({ locale: initialLocale, headerCopyByLocale }) {
  const [locale, setLocale] = useLocale(initialLocale);
  const pricing = getPublicPricing(locale);
  const values = publicPricingTextValues(locale);
  const copy = (key) => t(locale, `pricing.${key}`, values);
  return (
    <div className="min-h-screen bg-canvas font-display text-ink" lang={localeHtmlLang(locale)}>
      <PublicSiteHeader copy={headerCopyByLocale[normalizeLocale(locale)] || headerCopyByLocale['pt-BR']} locale={locale} onLocaleChange={setLocale} sectionBase="/" active="pricing" />
      <main>
        <section className="mx-auto max-w-5xl px-5 pb-10 pt-12 sm:px-8 sm:pt-16">
          <p className="mb-4 text-sm font-semibold text-brand-700">{copy('earlyBadge')}</p>
          <h1 className="mb-5 max-w-3xl text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1.12] tracking-tight">{copy('heroTitle')}</h1>
          <p className="max-w-2xl text-lg leading-8 text-ink-muted">{copy('heroLead')}</p>
        </section>
        <section className="mx-auto grid max-w-5xl gap-10 px-5 pb-16 sm:px-8 lg:grid-cols-[1fr_360px]" aria-labelledby="plan-title">
          <div className="order-last lg:order-first">
            <h2 id="plan-title" className="mb-3 text-2xl font-semibold">{copy('planName')}</h2>
            <p className="mb-6 max-w-xl text-sm leading-6 text-ink-muted">{copy('planDescription')}</p>
            <ul className="m-0 list-none space-y-3 p-0">
              {getPricingCoreFeatures(locale).map((feature) => <li key={feature} className="flex gap-3 text-sm leading-6 text-ink-muted"><span className="font-semibold text-success" aria-hidden>✓</span><span>{feature}</span></li>)}
            </ul>
          </div>
          <article className="order-first self-start rounded-card border border-brand-200 bg-surface p-6 shadow-card sm:p-8 lg:order-last">
            <p className="mb-3 text-sm font-medium text-ink-muted">{copy('priceLabel')}</p>
            <p className="m-0 text-5xl font-bold tracking-tight tabular-nums">{formatPublicPrice(locale, pricing.monthlyTotal, { whole: true })}</p>
            <p className="mb-6 mt-2 text-sm text-ink-muted">{copy('companyPrice')}</p>
            <ul className="mb-6 list-none space-y-3 border-y border-ink/10 py-5 pl-0">
              {[1, 2, 3].map((n) => <li key={n} className="flex gap-3 text-sm"><span className="text-success" aria-hidden>✓</span>{copy(`promise${n}`)}</li>)}
            </ul>
            <Link href="/signup" className="inline-flex min-h-touch w-full items-center justify-center rounded-control bg-action px-5 py-3.5 font-semibold text-action-ink no-underline hover:bg-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700">{copy('ctaSignup')}</Link>
            <p className="mb-0 mt-4 text-xs leading-5 text-ink-muted">{copy('trialNote')}</p>
            <p className="mb-0 mt-2 text-xs text-ink-faint">{copy(`currency${pricing.currency}`)}</p>
          </article>
        </section>
        <section className="border-y border-ink/10 bg-brand-50/50 py-12">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <h2 className="mb-4 max-w-2xl text-2xl font-semibold">{copy('whyTitle')}</h2>
            <p className="max-w-2xl text-base leading-7 text-ink-muted">{copy('whyBody')}</p>
          </div>
        </section>
        <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8" aria-labelledby="faq-title">
          <h2 id="faq-title" className="mb-7 text-2xl font-semibold">{copy('faqTitle')}</h2>
          <div className="max-w-3xl divide-y divide-ink/10">
            {[1, 2, 3, 4].map((n) => <details key={n} className="py-4"><summary className="min-h-touch cursor-pointer rounded-control py-2 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">{copy(`faq${n}Q`)}</summary><p className="mb-1 mt-3 text-sm leading-7 text-ink-muted">{copy(`faq${n}A`)}</p></details>)}
          </div>
        </section>
      </main>
      <footer className="relative z-[1] border-t border-ink/8 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>{t(locale, 'pricing.footerBrand')}</span>
          <div className="flex flex-wrap gap-4">
            <Link href={publicMarketingPath(locale)} className="text-ink-muted no-underline hover:text-ink">
              {t(locale, 'pricing.backHome')}
            </Link>
            <Link href="/login" className="text-ink-muted no-underline hover:text-ink">
              {t(locale, 'pricing.navLogin')}
            </Link>
            <Link href="/privacy" className="text-ink-muted no-underline hover:text-ink">
              {t(locale, 'pricing.footerPrivacy')}
            </Link>
            <Link href="/terms" className="text-ink-muted no-underline hover:text-ink">
              {t(locale, 'pricing.footerTerms')}
            </Link>
          </div>
        </div>
      </footer>
      <PublicLanguageLinks locale={locale} page="/pricing" />
    </div>
  );
}
