'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PublicSiteHeader } from './PublicSiteHeader';
import { useLocale } from '../../lib/useLocale';
import { localeHtmlLang, normalizeLocale, t } from '../../lib/i18n';
import { CollapsibleBlock } from './CollapsibleBlock';
import {
  PRICING_TIER_TOLERANCE,
  formatPublicPrice,
  getPublicPricing,
  publicPricingTextValues,
  publicPricingTierList,
} from '../../lib/pricing-currency';
import {
  PRODUCT_LANDING_CONTACT_EMAIL,
  getPricingAddons,
  getPricingCoreFeatures,
  EARLY_ADOPTER_COHORT_LIMIT,
  EARLY_ADOPTER_FREE_DAYS,
  EARLY_ADOPTER_MAX_EMPLOYEES,
  EARLY_ADOPTER_MIN_EMPLOYEES,
  DESIGN_PARTNER_FREE_MONTHS,
  PUBLIC_TRIAL_DAYS,
} from '../../lib/pricing-plans';

function SectionLabel({ children }) {
  return (
    <p className="mb-3 font-mono text-2xs uppercase tracking-[0.14em] text-brand-500/70">{children}</p>
  );
}

export default function PricingPageClient({ locale: initialLocale, headerCopyByLocale }) {
  const [locale, setLocale] = useLocale(initialLocale);
  const [employeeCount, setEmployeeCount] = useState(20);
  const [billingCycle, setBillingCycle] = useState('monthly');
  const coreFeatures = getPricingCoreFeatures(locale);
  const addons = getPricingAddons(locale);
  const pricing = useMemo(() => getPublicPricing(locale, { employeeCount, billingCycle }), [locale, billingCycle, employeeCount]);
  const tierList = useMemo(() => publicPricingTierList(locale, billingCycle), [locale, billingCycle]);
  const money = (value) => formatPublicPrice(locale, value);
  const wholeMoney = (value) => formatPublicPrice(locale, value, { whole: true });
  const pricingTextValues = publicPricingTextValues(locale);

  return (
    <div className="min-h-screen bg-canvas font-display text-ink" lang={localeHtmlLang(locale)}>
      <div className="pointer-events-none fixed inset-0 bg-radial-glow opacity-80" aria-hidden />

      <PublicSiteHeader
        copy={headerCopyByLocale[normalizeLocale(locale)] || headerCopyByLocale['pt-BR']}
        locale={locale}
        onLocaleChange={setLocale}
        sectionBase="/"
        active="pricing"
      />

      <main className="relative z-[1]">
        <section className="mx-auto max-w-5xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16">
          <p className="mb-4 inline-block rounded-control border border-success/25 bg-success/10 px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.1em] text-success">
            {t(locale, 'pricing.earlyBadge')}
          </p>
          <h1 className="mb-4 max-w-2xl text-ink text-[clamp(2rem,5.5vw,3rem)] font-bold leading-[1.12]">
            {t(locale, 'pricing.heroTitle')}
          </h1>
          <p className="mb-2 max-w-2xl text-lg leading-relaxed text-ink">{t(locale, 'pricing.heroLead')}</p>
          <p className="max-w-2xl text-base leading-relaxed text-ink-muted">{t(locale, 'pricing.heroBody')}</p>
        </section>

        <section className="border-y border-ink/8 bg-white/50 py-14" aria-labelledby="plan-title">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <SectionLabel>{t(locale, 'pricing.planLabel')}</SectionLabel>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr),minmax(320px,390px)] lg:items-start">
              <div>
                <h2 id="plan-title" className="mb-2 mt-0 text-2xl font-normal text-ink sm:text-[1.75rem]">
                  {t(locale, 'pricing.planName')}
                </h2>
                <p className="mb-6 max-w-xl text-sm leading-relaxed text-ink-muted">{t(locale, 'pricing.planDescription')}</p>
                <ul className="m-0 list-none space-y-2.5 p-0">
                  {coreFeatures.map((line) => (
                    <li
                      key={line}
                      className="relative pl-5 text-sm leading-relaxed text-ink-muted before:absolute before:left-0 before:text-success before:content-['✓']"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <article className="min-w-0 rounded-card border-2 border-brand-200 bg-canvas/90 p-5 shadow-sm sm:p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-brand-500/80">
                      {t(locale, 'pricing.priceLabel')}
                    </p>
                    <p className="mb-1 mt-0 flex flex-wrap items-baseline gap-x-1 gap-y-1 text-3xl font-normal text-ink">
                      {pricing.custom ? (
                        <span>{t(locale, 'pricing.completePriceValue')}</span>
                      ) : (
                        <>
                          <span className="whitespace-nowrap tabular-nums">{wholeMoney(pricing.monthlyTotal)}</span>
                          <span className="text-sm text-ink-muted">{t(locale, 'pricing.perMonth')}</span>
                        </>
                      )}
                    </p>
                    <p className="m-0 text-sm font-medium text-ink">
                      {pricing.custom
                        ? t(locale, 'pricing.tierAbove', { n: EARLY_ADOPTER_MAX_EMPLOYEES })
                        : t(locale, 'pricing.tierRange', { min: pricing.tierMin, max: pricing.tierMax })}
                    </p>
                    {!pricing.custom ? (
                      <>
                        <p className="m-0 text-xs leading-relaxed text-ink-muted">
                          {t(locale, 'pricing.perEmployeeEquivalent', { price: money(pricing.perEmployee) })}
                        </p>
                        <p className="mb-0 mt-1 text-xs font-medium leading-relaxed text-success">
                          {t(locale, 'pricing.launchPriceNote')}
                        </p>
                      </>
                    ) : null}
                    <p className="m-0 text-xs leading-relaxed text-ink-muted">{t(locale, `pricing.currency${pricing.currency}`)}</p>
                    {billingCycle === 'annual' && !pricing.custom && (
                      <p className="mb-0 mt-1 text-xs leading-relaxed text-ink-muted">{t(locale, 'pricing.annualBillingNote')}</p>
                    )}
                  </div>
                  <span className="rounded-control border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                    {t(locale, 'pricing.earlyAdopterDaysBadge', { n: EARLY_ADOPTER_FREE_DAYS })}
                  </span>
                </div>
                <p className="mb-4 text-xs leading-relaxed text-ink-muted">
                  {t(locale, 'pricing.priceAfterTrial', {
                    trialDays: PUBLIC_TRIAL_DAYS,
                    earlyDays: EARLY_ADOPTER_FREE_DAYS,
                    cohort: EARLY_ADOPTER_COHORT_LIMIT,
                    designMonths: DESIGN_PARTNER_FREE_MONTHS,
                  })}
                </p>
                <div className="mb-4 rounded-control border border-ink/8 bg-white/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label htmlFor="pricing-employees" className="text-sm font-medium text-ink">
                      {t(locale, 'pricing.employeeCountLabel')}
                    </label>
                    <output htmlFor="pricing-employees" className="text-sm font-semibold tabular-nums text-ink">
                      {pricing.custom ? `${EARLY_ADOPTER_MAX_EMPLOYEES}+` : employeeCount} {t(locale, 'pricing.employeeUnit')}
                    </output>
                  </div>
                  <input
                    id="pricing-employees"
                    type="range"
                    min={EARLY_ADOPTER_MIN_EMPLOYEES}
                    max={EARLY_ADOPTER_MAX_EMPLOYEES + 1}
                    value={employeeCount}
                    onChange={(event) => setEmployeeCount(Number(event.target.value))}
                    className="w-full accent-brand-600"
                  />
                  <div className="mt-1 flex justify-between text-xs text-ink-faint">
                    <span>{EARLY_ADOPTER_MIN_EMPLOYEES}</span>
                    <span>{EARLY_ADOPTER_MAX_EMPLOYEES}+</span>
                  </div>
                </div>
                <div className="mb-4 rounded-control border border-ink/8 bg-ink/[0.035] p-1">
                  <div className="grid grid-cols-2 gap-1" role="group" aria-label={t(locale, 'pricing.billingCycleLabel')}>
                    {['monthly', 'annual'].map((cycle) => (
                      <button
                        key={cycle}
                        type="button"
                        onClick={() => setBillingCycle(cycle)}
                        aria-pressed={billingCycle === cycle}
                        className={`min-h-touch rounded-control px-3 py-2 text-sm transition ${billingCycle === cycle ? 'bg-white font-medium text-ink shadow-sm' : 'text-ink-muted'}`}
                      >
                        {t(locale, `pricing.billing${cycle === 'monthly' ? 'Monthly' : 'Annual'}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-4 rounded-card border border-brand-100 bg-brand-50/70 p-3.5">
                  {pricing.custom ? (
                    <p className="m-0 text-sm leading-relaxed text-ink" aria-live="polite">
                      {t(locale, 'pricing.customQuoteBody', { n: EARLY_ADOPTER_MAX_EMPLOYEES })}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" aria-live="polite" aria-atomic="true">
                        <span className="text-sm text-ink-muted">
                          {billingCycle === 'annual' ? t(locale, 'pricing.annualTotalLabel') : t(locale, 'pricing.monthlyTotalLabel')}
                        </span>
                        <strong className="whitespace-nowrap text-2xl font-semibold tabular-nums text-ink">
                          {wholeMoney(billingCycle === 'annual' ? pricing.annualTotal : pricing.monthlyTotal)}
                        </strong>
                      </div>
                      <p className="mb-0 mt-1 text-xs text-ink-muted">
                        {t(locale, 'pricing.totalAfterTrial', { n: EARLY_ADOPTER_FREE_DAYS })}
                      </p>
                    </>
                  )}
                  <p className="mb-0 mt-2 border-t border-brand-200/60 pt-2 text-2xs leading-5 text-ink-muted">
                    {t(locale, 'pricing.billingDefinition', { tolerance: Math.round(PRICING_TIER_TOLERANCE * 100) })}
                  </p>
                </div>
                <CollapsibleBlock
                  locale={locale}
                  title={t(locale, 'pricing.tiersTitle')}
                  className="mb-4"
                >
                  <ul className="m-0 list-none divide-y divide-ink/8 p-0">
                    {tierList.map((tier) => {
                      const active = !pricing.custom && tier.min === pricing.tierMin;
                      return (
                        <li
                          key={tier.min}
                          aria-current={active ? 'true' : undefined}
                          className={`flex items-baseline justify-between gap-3 px-1 py-2 text-sm ${active ? 'font-semibold text-ink' : 'text-ink-muted'}`}
                        >
                          <span className="tabular-nums">{t(locale, 'pricing.tierRange', { min: tier.min, max: tier.max })}</span>
                          <span className="whitespace-nowrap tabular-nums">{wholeMoney(tier.monthlyTotal)}{t(locale, 'pricing.perMonth')}</span>
                        </li>
                      );
                    })}
                    <li className={`flex items-baseline justify-between gap-3 px-1 py-2 text-sm ${pricing.custom ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                      <span>{t(locale, 'pricing.tierAbove', { n: EARLY_ADOPTER_MAX_EMPLOYEES })}</span>
                      <span>{t(locale, 'pricing.completePriceValue')}</span>
                    </li>
                  </ul>
                </CollapsibleBlock>
                <div className="grid gap-2 sm:grid-cols-2">
                  {pricing.custom ? (
                    <a
                      href={`mailto:${PRODUCT_LANDING_CONTACT_EMAIL}?subject=${encodeURIComponent(t(locale, 'pricing.enterpriseSubject'))}`}
                      className="inline-flex min-h-touch items-center justify-center rounded-control bg-action hover:bg-action-hover text-action-ink px-4 py-3 text-sm font-semibold no-underline"
                    >
                      {t(locale, 'pricing.enterpriseCta')}
                    </a>
                  ) : (
                    <Link
                      href="/signup"
                      className="inline-flex min-h-touch items-center justify-center rounded-control bg-action hover:bg-action-hover text-action-ink px-4 py-3 text-sm font-semibold no-underline"
                    >
                      {t(locale, 'pricing.ctaSignup')}
                    </Link>
                  )}
                  <Link
                    href="/login"
                    className="inline-flex min-h-touch items-center justify-center rounded-control border border-ink/12 bg-white/70 px-4 py-3 text-sm text-ink no-underline"
                  >
                    {t(locale, 'pricing.ctaLogin')}
                  </Link>
                </div>
                <p className="mb-0 mt-3 text-xs leading-relaxed text-ink-faint">
                  {t(locale, 'pricing.contactLead')}{' '}
                  <a
                    href={`mailto:${PRODUCT_LANDING_CONTACT_EMAIL}?subject=${encodeURIComponent(t(locale, 'pricing.contactSubject'))}`}
                    className="text-brand-600 underline-offset-2 hover:underline"
                  >
                    {PRODUCT_LANDING_CONTACT_EMAIL}
                  </a>
                </p>
              </article>
            </div>

            <article className="mt-6 grid gap-6 rounded-card border border-ink/10 bg-white/75 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr),260px] lg:items-center">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="mb-0 font-mono text-2xs uppercase tracking-[0.14em] text-brand-500/70">
                    {t(locale, 'pricing.completePlanLabel')}
                  </p>
                  <span className="rounded-control border border-ink/12 bg-ink/[0.04] px-2 py-1 font-mono text-2xs text-ink-muted">
                    {t(locale, 'pricing.completePlanBadge')}
                  </span>
                </div>
                <h3 className="mb-2 mt-0 text-xl font-normal text-ink">{t(locale, 'pricing.completePlanName')}</h3>
                <p className="mb-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  {t(locale, 'pricing.completePlanDescription')}
                </p>
                <ul className="m-0 grid list-none gap-x-5 gap-y-2 p-0 text-sm text-ink-muted sm:grid-cols-2">
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n} className="relative pl-5 leading-relaxed before:absolute before:left-0 before:text-success before:content-['✓']">
                      {t(locale, `pricing.completeFeature${n}`)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-control border border-brand-100 bg-brand-50/60 p-4 lg:text-center">
                <p className="mb-1 font-mono text-2xs uppercase tracking-[0.12em] text-brand-500/80">
                  {t(locale, 'pricing.completePriceLabel')}
                </p>
                <p className="mb-1 mt-0 text-2xl font-normal text-ink">{t(locale, 'pricing.completePriceValue')}</p>
                <p className="mb-4 text-xs leading-relaxed text-ink-muted">{t(locale, 'pricing.completePriceNote')}</p>
                <a
                  href={`mailto:${PRODUCT_LANDING_CONTACT_EMAIL}?subject=${encodeURIComponent(t(locale, 'pricing.completeContactSubject'))}`}
                  className="inline-flex min-h-touch w-full items-center justify-center rounded-control border border-brand-300 bg-white/80 px-4 py-3 text-sm text-brand-700 no-underline hover:border-brand-400"
                >
                  {t(locale, 'pricing.completeCta')}
                </a>
              </div>
            </article>
          </div>
        </section>

        {addons.length ? <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8" aria-labelledby="addons-title">
          <SectionLabel>{t(locale, 'pricing.addonsLabel')}</SectionLabel>
          <h2 id="addons-title" className="mb-3 mt-0 text-2xl font-normal text-ink sm:text-[1.75rem]">
            {t(locale, 'pricing.addonsTitle')}
          </h2>
          <p className="mb-8 max-w-2xl text-sm leading-relaxed text-ink-muted">{t(locale, 'pricing.addonsLead')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {addons.map((addon) => (
              <article
                key={addon.id}
                className="rounded-card border border-ink/10 bg-white/60 p-5 opacity-90"
                aria-disabled="true"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-base font-normal text-ink">{addon.name}</h3>
                  <span className="rounded-control border border-ink/12 bg-ink/[0.04] px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-faint">
                    {addon.statusLabel}
                  </span>
                </div>
                <p className="m-0 text-sm leading-relaxed text-ink-muted">{addon.description}</p>
              </article>
            ))}
          </div>
        </section> : null}

        <section className="border-y border-ink/8 bg-brand-50/70 py-14" aria-labelledby="enterprise-title">
          <div className="mx-auto max-w-5xl px-5 sm:px-8">
            <SectionLabel>{t(locale, 'pricing.enterpriseLabel')}</SectionLabel>
            <h2 id="enterprise-title" className="mb-3 mt-0 text-2xl font-normal text-ink sm:text-[1.75rem]">
              {t(locale, 'pricing.enterpriseTitle')}
            </h2>
            <p className="mb-6 max-w-2xl text-base leading-relaxed text-ink-muted">{t(locale, 'pricing.enterpriseBody')}</p>
            <a
              href={`mailto:${PRODUCT_LANDING_CONTACT_EMAIL}?subject=${encodeURIComponent(t(locale, 'pricing.enterpriseSubject'))}`}
              className="inline-flex min-h-touch items-center rounded-control border border-brand-300 bg-white/80 px-5 py-3.5 text-sm text-brand-700 no-underline hover:border-brand-400"
            >
              {t(locale, 'pricing.enterpriseCta')}
            </a>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-14 sm:px-8" aria-labelledby="faq-title">
          <SectionLabel>{t(locale, 'pricing.faqLabel')}</SectionLabel>
          <h2 id="faq-title" className="mb-8 mt-0 text-2xl font-normal text-ink sm:text-[1.75rem]">
            {t(locale, 'pricing.faqTitle')}
          </h2>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((n) => (
              <details
                key={n}
                className="group rounded-card border border-ink/10 bg-white/80 px-4 py-3 open:shadow-sm"
              >
                <summary className="cursor-pointer list-none text-base text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                  {t(locale, `pricing.faq${n}Q`)}
                </summary>
                <p className="mb-1 mt-3 text-sm leading-relaxed text-ink-muted">{t(locale, `pricing.faq${n}A`, pricingTextValues)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">
          <h2 className="mb-3 mt-0 text-2xl font-normal text-ink">{t(locale, 'pricing.closeTitle')}</h2>
          <p className="mb-8 max-w-xl text-sm leading-relaxed text-ink-muted">{t(locale, 'pricing.closeBody')}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="inline-flex min-h-touch items-center rounded-control bg-action hover:bg-action-hover text-action-ink px-5 py-3.5 text-sm font-semibold no-underline"
            >
              {t(locale, 'pricing.ctaSignup')}
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-touch items-center rounded-control border border-ink/12 bg-white/70 px-5 py-3.5 text-sm text-ink no-underline"
            >
              {t(locale, 'pricing.backHome')}
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-[1] border-t border-ink/8 py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>{t(locale, 'pricing.footerBrand')}</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="text-ink-muted no-underline hover:text-ink">
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
    </div>
  );
}
