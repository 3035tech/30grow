import Link from 'next/link';
import { t } from '../../lib/i18n';
import { formatPublicPrice, PUBLIC_BRL_TIERS, publicPricingTextValues } from '../../lib/pricing-currency';

/** BRL launch offer. Shared by the landing and pricing page. */
export function PublicPricingPlans({ locale, showLaunchOffer = false }) {
  const values = publicPricingTextValues(locale);
  const copy = (key, extra) => t(locale, `pricing.${key}`, { ...values, ...extra });
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {PUBLIC_BRL_TIERS.map((tier) => (
          <article key={tier.id} className="flex min-w-0 flex-col rounded-card border border-brand-200 bg-surface p-6 sm:p-7">
            <h3 className="m-0 text-lg font-semibold text-ink">
              {copy(tier.min === 1 ? 'firstTierRange' : 'tierRange', tier)}
            </h3>
            <p className="mb-0 mt-6 text-4xl font-bold tracking-tight tabular-nums text-ink">
              {formatPublicPrice(locale, tier.monthlyTotal, { whole: true })}
            </p>
            <p className="mb-0 mt-2 text-sm text-ink-muted">{copy('companyPrice')}</p>
            <p className="mb-0 mt-5 border-t border-ink/10 pt-4 text-sm font-medium text-brand-700">{copy('featuresIncluded')}</p>
            {tier.annualTotal ? (
              <p className="mb-0 mt-3 text-sm leading-6 text-ink-muted">{copy('annualTierNote', { price: formatPublicPrice(locale, tier.annualTotal, { whole: true }) })}</p>
            ) : null}
            <div className="mt-auto pt-6">
              <Link href="/signup" className="inline-flex min-h-touch w-full items-center justify-center rounded-control bg-action px-4 py-3 text-center text-sm font-semibold text-action-ink no-underline hover:bg-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700">{copy('ctaSignup')}</Link>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3 border-b border-ink/10 pb-6 text-sm leading-6 text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0">{copy('customTierNote', { n: PUBLIC_BRL_TIERS.at(-1).max })}</p>
        <a href="mailto:contact@3035tech.com?subject=30Grow%3A%20proposta%20para%20mais%20de%20100%20colaboradores" className="inline-flex min-h-touch shrink-0 items-center font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{copy('quoteCta')}</a>
      </div>
      <p className="mb-0 mt-4 text-xs leading-5 text-ink-muted">{copy('billingDefinition')}</p>
      <p className="mb-0 mt-2 text-xs leading-5 text-ink-muted">{copy('usageNote')}</p>
      {showLaunchOffer ? (
        <aside className="mt-8 rounded-card border border-brand-200 bg-brand-50 p-6 sm:p-8">
          <h3 className="m-0 text-xl font-semibold text-ink">{copy('launchTitle')}</h3>
          <p className="mb-0 mt-3 max-w-3xl text-sm leading-7 text-ink-muted">{copy('launchBody')}</p>
          <Link href="/signup" className="mt-4 inline-flex min-h-touch items-center font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{copy('ctaSignup')}</Link>
        </aside>
      ) : null}
    </div>
  );
}
