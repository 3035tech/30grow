import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { PUBLIC_MARKETING_LOCALES, SOLUTION_SLUGS, publicMarketingRoute, publicMarketingPath, publicLanguageAlternates, publicHreflang } from '../../lib/public-marketing-paths.js';
import { publicMarketingSitemapEntries } from '../../lib/public-marketing-sitemap.js';
import { buildProductLandingMetadata, buildProductLandingJsonLd } from '../../lib/product-landing-seo.js';
import { buildPricingMetadata } from '../../lib/pricing-plans.js';
import { getPublicSolutions, buildSolutionMetadata } from '../../lib/public-solutions.js';
import { runtimeAppUrl } from '../../lib/app-url.js';
import { isCrawlerNoIndexPath } from '../../lib/crawler-guard.js';

const original = Object.fromEntries(['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL', 'APP_URL'].map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function configure() {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://30grow.com';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.30grow.com';
  process.env.APP_URL = 'https://app.30grow.com';
}

test('localized routes whitelist marketing only and reject protected-path aliases', () => {
  assert.equal(publicMarketingRoute('/').locale, 'pt-BR');
  assert.equal(publicMarketingRoute('/en').locale, 'en');
  for (const path of ['/en/dashboard', '/fr/api/admin', '/de/employee', '/es/login', '/en/blog', '/solucoes/nonexistent', '/en/solutions/nonexistent']) {
    assert.equal(publicMarketingRoute(path), null, path);
  }
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    for (let index = 0; index < SOLUTION_SLUGS.length; index++) {
      const path = publicMarketingPath(locale, 'solution', index);
      assert.deepEqual(publicMarketingRoute(path), { locale, page: 'solution', solutionIndex: index });
      assert.equal(isCrawlerNoIndexPath(path), false);
    }
  }
  for (const path of ['/dashboard', '/api/admin', '/employee/profile', '/t/token', '/v/token', '/login', '/avaliacao/token', '/feedback/token', '/formal-review/token', '/ouvidoria/token', '/prep/token', '/a/set-password']) assert.equal(isCrawlerNoIndexPath(path), true);
});

test('Google hreflang uses supported language and region codes', () => {
  assert.equal(publicHreflang('es-419'), 'es');
  assert.equal(publicHreflang('es-ES'), 'es-ES');
  assert.equal(publicHreflang('pt-BR'), 'pt-BR');
  for (const key of Object.keys(publicLanguageAlternates())) {
    assert.ok(key === 'x-default' || /^[a-z]{2}(?:-[A-Z]{2})?$/.test(key), key);
  }
});

test('every language has its own canonical and reciprocal alternate URLs', () => {
  configure();
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    for (const [page, build] of [['/', buildProductLandingMetadata], ['/pricing', buildPricingMetadata]]) {
      const metadata = build(locale);
      assert.equal(metadata.alternates.canonical, `https://30grow.com${publicMarketingPath(locale, page)}`);
      assert.deepEqual(metadata.alternates.languages, publicLanguageAlternates(page, null, 'https://30grow.com'));
      assert.equal(new Set(Object.values(metadata.alternates.languages)).size, PUBLIC_MARKETING_LOCALES.length);
      assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    }
    const graph = JSON.parse(buildProductLandingJsonLd(locale))['@graph'];
    assert.equal(graph.find((item) => item['@type'] === 'WebSite').url, 'https://30grow.com/');
    assert.equal(graph.find((item) => item['@type'] === 'WebPage').url, `https://30grow.com${publicMarketingPath(locale)}`);
  }
});

test('section pages have unique localized headings, descriptions and full visible feature lists', () => {
  configure();
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    const solutions = getPublicSolutions(locale);
    assert.equal(solutions.length, 6);
    assert.equal(new Set(solutions.map((item) => item.title)).size, 6);
    for (const item of solutions) {
      assert.ok(item.body.length > 200);
      assert.ok(item.items.length >= 6);
      const metadata = buildSolutionMetadata(locale, item.index);
      assert.ok(metadata.title.absolute.includes(item.title));
      assert.equal(metadata.alternates.canonical, `https://30grow.com${item.path}`);
      assert.deepEqual(metadata.alternates.languages, publicLanguageAlternates('solution', item.index, 'https://30grow.com'));
      assert.equal(metadata.robots.index, true);
    }
  }
});

test('sitemap includes every actual marketing translation, stable timestamps and no private URLs', () => {
  const entries = publicMarketingSitemapEntries('https://30grow.com');
  assert.equal(entries.length, PUBLIC_MARKETING_LOCALES.length * 8);
  assert.equal(new Set(entries.map((item) => item.url)).size, entries.length);
  for (const item of entries) {
    assert.ok(publicMarketingRoute(new URL(item.url).pathname));
    assert.equal(item.lastModified.toISOString(), '2026-10-09T00:00:00.000Z');
    assert.ok(Object.values(item.alternates.languages).includes(item.url));
    assert.doesNotMatch(item.url, /app\.30grow|login|signup|token|dashboard/);
  }
  assert.deepEqual(publicMarketingSitemapEntries(''), []);
});

test('public SEO configuration does not change invitation/authentication link origin', () => {
  configure();
  assert.equal(runtimeAppUrl(), 'https://app.30grow.com');
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.30grow.com';
  assert.equal(runtimeAppUrl(), 'https://app.30grow.com');
});
