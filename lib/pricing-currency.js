import { localeNumberLocale, normalizeLocale } from './i18n.js';

export const PUBLIC_MONTHLY_PRICES = Object.freeze({ BRL: 69, USD: 39 });

/** Product prices are BRL only in Brazilian Portuguese, USD in other locales. */
export function publicPricingCurrency(locale) {
  return normalizeLocale(locale) === 'pt-BR' ? 'BRL' : 'USD';
}

/** A single monthly subscription per company, with every feature included. */
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
  return { monthlyPrice: formatPublicPrice(locale, getPublicPricing(locale).monthlyTotal, { whole: true }) };
}
