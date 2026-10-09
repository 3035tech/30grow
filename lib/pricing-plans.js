/**
 * Public pricing / GTM — plan constants (no Stripe yet).
 * Copy lives in lib/i18n.js under `pricing.*`.
 */

import { localeHtmlLang, localeOpenGraph, t, normalizeLocale } from './i18n.js';
import { getPublicPricing } from './pricing-currency.js';
import {
  PRODUCT_LANDING_CONTACT_EMAIL,
  productLandingAbsoluteUrl,
  productLandingOgImageUrl,
} from './product-landing-seo.js';
import { publicSiteBaseUrl } from './public-site-url.js';
import { publicMarketingPath, publicLanguageAlternates } from './public-marketing-paths.js';

export { PRODUCT_LANDING_CONTACT_EMAIL };

export const PRICING_PLAN_IDS = Object.freeze({
  RH_CORE: 'rh_core',
});

export const PRICING_ADDON_IDS = Object.freeze({
  DP: 'dp',
});

/** Ordered list of RH Core feature i18n keys (pricing.coreFeatureN). */
export const PRICING_CORE_FEATURE_COUNT = 11;

/** Add-ons shown as coming soon — not sold yet. */
export const PRICING_ADDON_ORDER = Object.freeze([]);

export const PUBLIC_TRIAL_DAYS = 30;

export function getPricingCoreFeatures(locale) {
  const loc = normalizeLocale(locale);
  const items = [];
  for (let i = 1; i <= PRICING_CORE_FEATURE_COUNT; i += 1) {
    items.push(t(loc, `pricing.coreFeature${i}`));
  }
  return items;
}

export function getPricingAddon(locale, id) {
  const loc = normalizeLocale(locale);
  return {
    id,
    name: t(loc, `pricing.addon.${id}.name`),
    description: t(loc, `pricing.addon.${id}.description`),
    status: 'coming_soon',
    statusLabel: t(loc, 'pricing.addonComingSoon'),
  };
}

export function getPricingAddons(locale) {
  return PRICING_ADDON_ORDER.map((id) => getPricingAddon(locale, id));
}

export function buildPricingMetadata(locale = 'pt-BR') {
  const loc = normalizeLocale(locale);
  const title = t(loc, 'pricing.metaTitle');
  const description = t(loc, 'pricing.metaDescription');
  const url = productLandingAbsoluteUrl(publicMarketingPath(loc, '/pricing'));
  const ogImage = productLandingOgImageUrl();
  const base = publicSiteBaseUrl();

  return {
    metadataBase: base ? new URL(base) : undefined,
    title: { absolute: title },
    description,
    keywords: t(loc, 'pricing.metaKeywords'),
    authors: [{ name: '3035Tech' }],
    creator: '3035Tech',
    publisher: '3035Tech',
    category: 'business',
    alternates: {
      canonical: url,
      languages: publicLanguageAlternates('/pricing', null, base),
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
        'max-video-preview': -1,
      },
    },
    openGraph: {
      type: 'website',
      url,
      title,
      description,
      siteName: '30Grow',
      locale: localeOpenGraph(loc),
      alternateLocale: ['pt_BR', 'en_US'].filter((tag) => tag !== localeOpenGraph(loc)),
      images: [{ url: ogImage, width: 512, height: 512, alt: '30Grow' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

function serializeJsonLdForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

export function buildPricingJsonLd(locale = 'pt-BR') {
  const loc = normalizeLocale(locale);
  const url = productLandingAbsoluteUrl(publicMarketingPath(loc, '/pricing'));
  const logo = productLandingOgImageUrl();
  const inLanguage = localeHtmlLang(loc);
  const features = getPricingCoreFeatures(loc);

  const webPage = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: t(loc, 'pricing.metaTitle'),
    description: t(loc, 'pricing.metaDescription'),
    inLanguage,
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${productLandingAbsoluteUrl('/')}#website`,
      name: '30Grow',
      url: productLandingAbsoluteUrl('/'),
    },
    primaryImageOfPage: { '@type': 'ImageObject', url: logo },
  };

  const offer = {
    '@type': 'Offer',
    name: t(loc, 'pricing.planName'),
    price: String(getPublicPricing(loc).monthlyTotal),
    priceCurrency: getPublicPricing(loc).currency,
    description: t(loc, 'pricing.heroLead'),
    priceSpecification: { '@type': 'UnitPriceSpecification', price: String(getPublicPricing(loc).monthlyTotal), priceCurrency: getPublicPricing(loc).currency, unitText: 'company/month', billingDuration: 'P1M' },
    availability: 'https://schema.org/InStock',
    url: productLandingAbsoluteUrl('/signup'),
  };

  const software = {
    '@type': 'SoftwareApplication',
    name: '30Grow',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'HumanResourcesApplication',
    operatingSystem: 'Web',
    inLanguage: ['pt-BR', 'en'],
    description: t(loc, 'pricing.metaDescription'),
    url: productLandingAbsoluteUrl('/'),
    offers: offer,
    featureList: features,
  };

  return serializeJsonLdForScript({
    '@context': 'https://schema.org',
    '@graph': [webPage, software],
  });
}
