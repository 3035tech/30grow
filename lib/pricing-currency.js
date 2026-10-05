import { localeNumberLocale, normalizeLocale } from './i18n.js';

export const EARLY_ADOPTER_ANNUAL_DISCOUNT = 0.8;

/**
 * Fixed monthly price per band of active employees (whole currency units).
 * BRL and USD are independent commercial prices; exchange rates must not alter them.
 * The last band (`max: null`) is quoted by sales.
 */
export const PUBLIC_PRICING_TIERS = Object.freeze([
  Object.freeze({ min: 5, max: 10, brl: 69, usd: 39 }),
  Object.freeze({ min: 11, max: 25, brl: 159, usd: 95 }),
  Object.freeze({ min: 26, max: 50, brl: 299, usd: 179 }),
  Object.freeze({ min: 51, max: 100, brl: 549, usd: 329 }),
  Object.freeze({ min: 101, max: 200, brl: 990, usd: 590 }),
  Object.freeze({ min: 201, max: null, brl: null, usd: null }),
]);

/** Largest employee count with a public price; above it the page asks for contact. */
export const PUBLIC_PRICING_MAX_EMPLOYEES = PUBLIC_PRICING_TIERS.at(-2).max;

/** A company only moves up a band after exceeding its top by this share. */
export const PRICING_TIER_TOLERANCE = 0.1;

/** Product prices are BRL only in Brazilian Portuguese, USD in other locales. */
export function publicPricingCurrency(locale) {
  return normalizeLocale(locale) === 'pt-BR' ? 'BRL' : 'USD';
}

function clampEmployeeCount(employeeCount) {
  const n = Math.floor(Number(employeeCount) || 0);
  return Math.max(PUBLIC_PRICING_TIERS[0].min, n);
}

export function pricingTierFor(employeeCount) {
  const n = clampEmployeeCount(employeeCount);
  return PUBLIC_PRICING_TIERS.find((tier) => tier.max == null || n <= tier.max);
}

function tierPrice(tier, currency) {
  return currency === 'BRL' ? tier.brl : tier.usd;
}

export function getPublicPricing(locale, { employeeCount = PUBLIC_PRICING_TIERS[0].min, billingCycle = 'monthly' } = {}) {
  const currency = publicPricingCurrency(locale);
  const n = clampEmployeeCount(employeeCount);
  const tier = pricingTierFor(n);
  const listPrice = tierPrice(tier, currency);
  if (listPrice == null) {
    return { currency, tierMin: tier.min, tierMax: null, custom: true, monthlyTotal: null, annualTotal: null, perEmployee: null };
  }
  const monthlyTotal = billingCycle === 'annual' ? Math.round(listPrice * EARLY_ADOPTER_ANNUAL_DISCOUNT) : listPrice;
  return {
    currency,
    tierMin: tier.min,
    tierMax: tier.max,
    custom: false,
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    perEmployee: Math.round((monthlyTotal * 100) / n) / 100,
  };
}

/** Priced bands for the given locale and billing cycle (custom band excluded). */
export function publicPricingTierList(locale, billingCycle = 'monthly') {
  const currency = publicPricingCurrency(locale);
  return PUBLIC_PRICING_TIERS.filter((tier) => tier.max != null).map((tier) => {
    const listPrice = tierPrice(tier, currency);
    return {
      min: tier.min,
      max: tier.max,
      monthlyTotal: billingCycle === 'annual' ? Math.round(listPrice * EARLY_ADOPTER_ANNUAL_DISCOUNT) : listPrice,
    };
  });
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

/** `{monthlyPrice}` = entry band price; `{firstTierMax}` = its employee cap. */
export function publicPricingTextValues(locale) {
  const first = PUBLIC_PRICING_TIERS[0];
  return {
    monthlyPrice: formatPublicPrice(locale, tierPrice(first, publicPricingCurrency(locale)), { whole: true }),
    firstTierMax: first.max,
  };
}
