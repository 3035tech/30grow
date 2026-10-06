import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, LOCALES, normalizeLocale } from '../../lib/i18n';
import { buildPricingJsonLd, buildPricingMetadata } from '../../lib/pricing-plans';
import { getPublicHeaderCopy } from '../../lib/product-landing-seo';
import PricingPageClient from '../_components/PricingPageClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  return buildPricingMetadata(locale);
}

export default async function PricingPage() {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const jsonLd = buildPricingJsonLd(locale);
  const headerCopyByLocale = Object.fromEntries(LOCALES.map((loc) => [loc, getPublicHeaderCopy(loc)]));

  return (
    <>
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <PricingPageClient locale={locale} headerCopyByLocale={headerCopyByLocale} />
    </>
  );
}
