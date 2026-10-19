import { localeNumberLocale, normalizeLocale } from './i18n.js';

export const PUBLIC_MONTHLY_PRICES = Object.freeze({ BRL: 149, USD: 39 });

// Public BRL offer only. Subscription enforcement belongs to the billing integration.
export const PUBLIC_BRL_TIERS = Object.freeze([
  Object.freeze({ id: 'small', min: 1, max: 20, monthlyTotal: 149, annualTotal: 1490 }),
  Object.freeze({ id: 'growing', min: 21, max: 50, monthlyTotal: 249 }),
  Object.freeze({ id: 'medium', min: 51, max: 100, monthlyTotal: 399 }),
]);
export const PUBLIC_BRL_LAUNCH = Object.freeze({ monthlyTotal: 99, months: 12, companies: 20, maxEmployees: 20 });

/** Product prices are BRL only in Brazilian Portuguese, USD in other locales. */
export function publicPricingCurrency(locale) {
  return normalizeLocale(locale) === 'pt-BR' ? 'BRL' : 'USD';
}

/** Entry price; BRL tiers share all features. International pricing is unchanged. */
export function getPublicPricing(locale) {
  const currency = publicPricingCurrency(locale);
  return { currency, monthlyTotal: PUBLIC_MONTHLY_PRICES[currency] };
}

export function formatPublicPrice(locale, amount, { whole = false } = {}) {
  const currency = publicPricingCurrency(locale);
  const digits = whole ? 0 : 2;
  return new Intl.NumberFormat(localeNumberLocale(locale), {
    style: 'currency', currency,
    currencyDisplay: currency === 'USD' ? 'code' : 'symbol',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amount);
}

/** Shared price interpolation for landing, pricing and signup. */
export function publicPricingTextValues(locale) {
  return {
    monthlyPrice: formatPublicPrice(locale, getPublicPricing(locale).monthlyTotal, { whole: true }),
    firstTierMax: PUBLIC_BRL_TIERS[0].max,
    secondTierPrice: formatPublicPrice(locale, PUBLIC_BRL_TIERS[1].monthlyTotal, { whole: true }),
    thirdTierPrice: formatPublicPrice(locale, PUBLIC_BRL_TIERS[2].monthlyTotal, { whole: true }),
    secondTierMin: PUBLIC_BRL_TIERS[1].min,
    secondTierMax: PUBLIC_BRL_TIERS[1].max,
    thirdTierMin: PUBLIC_BRL_TIERS[2].min,
    thirdTierMax: PUBLIC_BRL_TIERS[2].max,
    annualPrice: formatPublicPrice(locale, PUBLIC_BRL_TIERS[0].annualTotal, { whole: true }),
    launchPrice: formatPublicPrice(locale, PUBLIC_BRL_LAUNCH.monthlyTotal, { whole: true }),
    launchMonths: PUBLIC_BRL_LAUNCH.months,
    launchCompanies: PUBLIC_BRL_LAUNCH.companies,
  };
}
