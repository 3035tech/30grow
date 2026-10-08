import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPublicPrice, getPublicPricing, publicPricingTextValues } from '../../lib/pricing-currency.js';
import { t, localeRegionConfig } from '../../lib/i18n.js';
import { getProductLandingCopy, buildProductLandingJsonLd, buildProductLlmsTxt } from '../../lib/product-landing-seo.js';
import { buildPricingJsonLd, getPricingCoreFeatures } from '../../lib/pricing-plans.js';

for (const locale of ['pt-BR', 'pt-PT', 'en', 'es-419', 'es-ES', 'fr-FR', 'de-DE']) {
  const amount = locale === 'pt-BR' ? 69 : 39;
  const currency = locale === 'pt-BR' ? 'BRL' : 'USD';
  test(`${locale}: one monthly company price regardless of headcount`, () => {
    for (const employeeCount of [0, 1, 5, 10, 26, 100, 200, 201, 1000]) {
      assert.deepEqual(getPublicPricing(locale, { employeeCount }), { currency, monthlyTotal: amount });
    }
  });
  test(`${locale}: public copy and structured offers agree`, () => {
    const copy = getProductLandingCopy(locale);
    const values = publicPricingTextValues(locale);
    const price = formatPublicPrice(locale, amount, { whole: true });
    for (const text of [copy.pricingSnapshotBody, t(locale, 'pricing.trialNote', values),
      t(locale, 'pricing.faq1A', values), t(locale, 'signup.intro', values)]) {
      assert.ok(text.includes(price), text);
      assert.doesNotMatch(text, /\{monthlyPrice\}|\{firstTierMax\}|90|20%|200/);
    }
    assert.equal(getPricingCoreFeatures(locale).length, 11);
    for (const build of [buildProductLandingJsonLd, buildPricingJsonLd]) {
      const offer = JSON.parse(build(locale))['@graph'].find(item => item['@type'] === 'SoftwareApplication').offers;
      assert.equal(offer.priceCurrency, currency);
      assert.equal(Number(offer.price), amount);
      assert.equal(offer.priceSpecification.billingDuration, 'P1M');
    }
    assert.doesNotMatch(JSON.stringify({ hero: copy.heroBody, badge: copy.earlyBadge, proof: copy.ui.heroProof, offer: copy.earlyBody, faqs: copy.faqs }), /first 20|primeiras 20|90 days|90 dias|firstTierMax|monthlyPrice|20%/);
  });
}
test('public pricing leaves payroll and expense currencies unchanged', () => {
  assert.equal(localeRegionConfig('pt-PT').currency, 'EUR');
  assert.equal(getPublicPricing('pt_pt').currency, 'USD');
});
test('crawler offer describes one company plan', () => {
  const offer = buildProductLlmsTxt().split('\n').find(line => line.startsWith('Offer:'));
  assert.match(offer, /One monthly plan per company/);
  assert.doesNotMatch(offer, /by quote|200|first 20|90 days|band/);
});
