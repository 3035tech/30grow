import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPublicPrice, getPublicPricing, publicPricingTextValues, PUBLIC_BRL_TIERS, PUBLIC_BRL_LAUNCH } from '../../lib/marketing/pricing-currency.js';
import { t, localeRegionConfig } from '../../lib/i18n.js';
import { getProductLandingCopy, buildProductLandingJsonLd, buildProductLlmsTxt } from '../../lib/marketing/product-landing-seo.js';
import { buildPricingJsonLd, getPricingCoreFeatures } from '../../lib/marketing/pricing-plans.js';

for (const locale of ['pt-BR', 'pt-PT', 'en', 'es-419', 'es-ES', 'fr-FR', 'de-DE']) {
  const amount = locale === 'pt-BR' ? 149 : 39;
  const currency = locale === 'pt-BR' ? 'BRL' : 'USD';
  test(`${locale}: entry price is consistent across public surfaces`, () => {
    assert.deepEqual(getPublicPricing(locale), { currency, monthlyTotal: amount });
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
    const commercial = JSON.stringify({ hero: copy.heroBody, badge: copy.earlyBadge, proof: copy.ui.heroProof, offer: copy.earlyBody, faqs: copy.faqs });
    assert.doesNotMatch(commercial, /90 days|90 dias|firstTierMax|monthlyPrice|20%/);
    if (locale === 'pt-BR') {
      assert.match(copy.earlyTitle, /primeiras 20 empresas/);
      assert.match(copy.earlyBody, /99.*12 meses.*20 colaboradores.*149/);
      assert.doesNotMatch(commercial, /sem faixas|R\$\s*69|ilimitad/i);
    } else {
      assert.doesNotMatch(commercial, /first 20|primeiras 20|R\$/);
    }
  });
}
test('public pricing leaves payroll and expense currencies unchanged', () => {
  assert.equal(localeRegionConfig('pt-PT').currency, 'EUR');
  assert.equal(getPublicPricing('pt_pt').currency, 'USD');
});
test('crawler offer describes BRL tiers and bounded launch terms', () => {
  const offer = buildProductLlmsTxt().split('\n').find(line => line.startsWith('Offer:'));
  assert.match(offer, /BRL 149.*20 active employees.*BRL 249.*21–50.*BRL 399.*51–100/);
  assert.match(offer, /above 100 by quote/);
  assert.match(offer, /BRL 1490 paid upfront/);
  assert.match(offer, /First 20 eligible companies.*BRL 99.*12 months.*then BRL 149/);
  assert.match(offer, /30-day trial without a card/);
  assert.doesNotMatch(offer, /90 days|20%|BRL 69/);
});

test('BRL launch and annual terms agree with rendered copy', () => {
  assert.deepEqual(PUBLIC_BRL_TIERS.map(tier => [tier.min, tier.max, tier.monthlyTotal]), [[1, 20, 149], [21, 50, 249], [51, 100, 399]]);
  assert.equal(PUBLIC_BRL_TIERS[0].annualTotal, PUBLIC_BRL_TIERS[0].monthlyTotal * 10);
  assert.equal(PUBLIC_BRL_LAUNCH.monthlyTotal, 99);
  const values = publicPricingTextValues('pt-BR');
  for (const key of ['faq5A', 'launchBody', 'launchSignupNote']) {
    const text = t('pt-BR', `pricing.${key}`, values);
    for (const expected of [/99/, /12 meses/, /20 colaboradores/, /149/]) assert.match(text, expected);
    assert.doesNotMatch(text, /\{\w+\}/);
  }
  const annual = t('pt-BR', 'pricing.faq6A', values);
  assert.ok(annual.includes(formatPublicPrice('pt-BR', 1490, { whole: true })));
  assert.match(annual, /antecipadamente|antecipado/);
});
