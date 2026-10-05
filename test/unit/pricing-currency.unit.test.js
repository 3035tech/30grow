import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_PRICING_MAX_EMPLOYEES,
  PUBLIC_PRICING_TIERS,
  formatPublicPrice,
  getPublicPricing,
  pricingTierFor,
  publicPricingTextValues,
  publicPricingTierList,
} from '../../lib/pricing-currency.js';
import { t, localeRegionConfig } from '../../lib/i18n.js';
import { getProductLandingCopy, buildProductLandingJsonLd } from '../../lib/product-landing-seo.js';
import { EARLY_ADOPTER_MAX_EMPLOYEES, buildPricingJsonLd } from '../../lib/pricing-plans.js';

test('pricing tiers are contiguous, ascending and end in a custom quote band', () => {
  for (let i = 1; i < PUBLIC_PRICING_TIERS.length; i += 1) {
    const prev = PUBLIC_PRICING_TIERS[i - 1];
    const cur = PUBLIC_PRICING_TIERS[i];
    assert.equal(cur.min, prev.max + 1);
    if (cur.max != null) {
      assert.ok(cur.brl > prev.brl && cur.usd > prev.usd);
      assert.ok(cur.brl / cur.max < prev.brl / prev.max, 'per-employee price falls as bands grow');
    }
  }
  const last = PUBLIC_PRICING_TIERS.at(-1);
  assert.equal(last.max, null);
  assert.equal(last.brl, null);
});

test('band lookup respects edges and clamps below the minimum', () => {
  assert.equal(pricingTierFor(1).min, 5);
  assert.equal(pricingTierFor(10).max, 10);
  assert.equal(pricingTierFor(11).min, 11);
  assert.equal(pricingTierFor(200).max, 200);
  assert.equal(pricingTierFor(201).max, null);
  assert.equal(pricingTierFor(500).max, null);
});

test('public price stops at 200 employees; above that is contact-only', () => {
  assert.equal(PUBLIC_PRICING_MAX_EMPLOYEES, 200);
  assert.equal(EARLY_ADOPTER_MAX_EMPLOYEES, 200);
  for (const locale of ['pt-BR', 'pt-PT', 'en', 'es-419', 'fr-FR', 'de-DE']) {
    const body = t(locale, 'pricing.customQuoteBody', { n: PUBLIC_PRICING_MAX_EMPLOYEES });
    assert.match(body, /200/);
    assert.doesNotMatch(body, /500|\{n\}/);
  }
});

for (const locale of ['pt-BR', 'pt-PT', 'en', 'es-419']) {
  const brazil = locale === 'pt-BR';

  test(`${locale}: fixed band price, annual discount and totals`, () => {
    const cases = [[5, 69, 39], [10, 69, 39], [26, 299, 179], [100, 549, 329], [200, 990, 590]];
    for (const [employeeCount, brl, usd] of cases) {
      const list = brazil ? brl : usd;
      const monthly = getPublicPricing(locale, { employeeCount, billingCycle: 'monthly' });
      assert.equal(monthly.currency, brazil ? 'BRL' : 'USD');
      assert.equal(monthly.monthlyTotal, list);
      assert.equal(monthly.annualTotal, list * 12);
      assert.equal(monthly.perEmployee, Math.round((list * 100) / employeeCount) / 100);
      const annual = getPublicPricing(locale, { employeeCount, billingCycle: 'annual' });
      assert.equal(annual.monthlyTotal, Math.round(list * 0.8));
      assert.equal(annual.annualTotal, Math.round(list * 0.8) * 12);
    }
    const custom = getPublicPricing(locale, { employeeCount: 201 });
    assert.equal(custom.custom, true);
    assert.equal(custom.monthlyTotal, null);
    assert.equal(publicPricingTierList(locale).length, PUBLIC_PRICING_TIERS.length - 1);
  });

  test(`${locale}: landing, FAQ, signup and structured data agree`, () => {
    const copy = getProductLandingCopy(locale);
    const values = publicPricingTextValues(locale);
    const price = formatPublicPrice(locale, brazil ? 69 : 39, { whole: true });
    const currency = brazil ? 'BRL' : 'USD';
    assert.equal(values.monthlyPrice, price);
    assert.ok(t(locale, `pricing.currency${currency}`).includes(currency));
    assert.match(t(locale, 'pricing.annualBillingNote'), /20%/);
    assert.match(t(locale, 'pricing.annualBillingNote'), /12/);
    assert.match(t(locale, 'pricing.billingDefinition', { tolerance: 10 }), /10/);
    for (const text of [copy.pricingSnapshotBody, copy.earlyBody,
      t(locale, 'pricing.faq1A', values), t(locale, 'signup.intro', values)]) {
      assert.ok(text.includes(price), text);
      assert.ok(text.includes(String(values.firstTierMax)), text);
      assert.doesNotMatch(text, /\{monthlyPrice\}|\{firstTierMax\}/);
      assert.doesNotMatch(text, / — /);
      if (!brazil) assert.doesNotMatch(text, /R\$|EUR|€/);
    }
    assert.ok(copy.faqs.some(({ a }) => a.includes(price)));
    for (const build of [buildProductLandingJsonLd, buildPricingJsonLd]) {
      const software = JSON.parse(build(locale))['@graph'].find((item) => item['@type'] === 'SoftwareApplication');
      assert.equal(software.offers.priceCurrency, currency);
      assert.equal(Number(software.offers.price), 0, 'Trial remains free');
    }
  });
}

test('public pricing does not change regional currencies for payroll and expenses', () => {
  assert.equal(localeRegionConfig('pt-PT').currency, 'EUR');
  assert.equal(getPublicPricing('en-US').monthlyTotal, 39);
  assert.equal(getPublicPricing('pt_pt').currency, 'USD');
});
