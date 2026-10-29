import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { PUBLIC_MARKETING_LOCALES, SOLUTION_SLUGS, publicBlogPath, publicMarketingRoute, publicMarketingPath, publicLanguageAlternates, publicHreflang, publicSolutionCanonicalPath } from '../../lib/marketing/public-marketing-paths.js';
import { publicMarketingSitemapEntries } from '../../lib/marketing/public-marketing-sitemap.js';
import { buildProductLandingMetadata, buildProductLandingJsonLd } from '../../lib/marketing/product-landing-seo.js';
import { buildPricingMetadata, buildPricingJsonLd } from '../../lib/marketing/pricing-plans.js';
import { buildBlogIndexJsonLd, buildBlogPostJsonLd, listBlogPosts } from '../../lib/blog/index.js';
import { getPublicSolutions, buildSolutionMetadata } from '../../lib/marketing/public-solutions.js';
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

test('blog links carry the selected UI locale without changing canonical article paths', () => {
  assert.equal(publicBlogPath('pt-BR'), '/blog');
  assert.equal(publicBlogPath('en'), '/blog?lang=en');
  assert.equal(publicBlogPath('es-ES', 'pesquisa-de-clima-e-enps'), '/blog/pesquisa-de-clima-e-enps?lang=es-ES');
});

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
      assert.equal(metadata.alternates.canonical, `https://30grow.com${publicSolutionCanonicalPath(locale, item.index)}`);
      assert.deepEqual(metadata.alternates.languages, publicLanguageAlternates('solution', item.index, 'https://30grow.com'));
      assert.equal(metadata.robots.index, true);
    }
  }
});

test('sitemap includes every actual marketing translation, stable timestamps and no private URLs', () => {
  const entries = publicMarketingSitemapEntries('https://30grow.com');
  assert.equal(entries.length, PUBLIC_MARKETING_LOCALES.length * 8 - 12);
  assert.equal(new Set(entries.map((item) => item.url)).size, entries.length);
  for (const item of entries) {
    assert.ok(publicMarketingRoute(new URL(item.url).pathname));
    assert.equal(item.lastModified.toISOString(), '2026-10-15T00:00:00.000Z');
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


test('search images and brand entity use the public 30Grow organization', () => {
  configure();
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    const graph = JSON.parse(buildProductLandingJsonLd(locale))['@graph'];
    const organization = graph.find((item) => item['@type'] === 'Organization');
    assert.equal(organization.name, '30Grow');
    assert.equal(organization.logo.url, 'https://30grow.com/brand/logo-512.png');
    assert.deepEqual(organization.sameAs, ['https://www.linkedin.com/company/30grow/', 'https://www.instagram.com/30grow/']);
    assert.equal(organization.parentOrganization['@id'], 'https://3035tech.com/#organization');
    assert.equal(graph.find((item) => item['@id'] === 'https://3035tech.com/#organization').name, '3035Tech');
    assert.equal(graph.find((item) => item['@type'] === 'WebSite').publisher['@id'], organization['@id']);
    assert.equal(graph.find((item) => item['@type'] === 'SoftwareApplication').publisher['@id'], organization['@id']);
    const image = graph.find((item) => item['@type'] === 'WebPage').primaryImageOfPage;
    assert.equal(image.url, 'https://30grow.com/product/visao-geral.webp');
    assert.ok(image.width >= 1200);
    const metadata = buildProductLandingMetadata(locale);
    assert.equal(metadata.openGraph.images[0].url, 'https://30grow.com/brand/30grow-share.png');
    assert.equal(metadata.openGraph.images[0].width, 1200);
    assert.equal(metadata.openGraph.images[0].height, 630);
    assert.equal(metadata.twitter.images[0], metadata.openGraph.images[0].url);
    assert.ok(metadata.openGraph.images[0].alt?.length > 20);
  }
  const entries = publicMarketingSitemapEntries('https://30grow.com');
  assert.equal(entries.filter((entry) => entry.images?.length).length, PUBLIC_MARKETING_LOCALES.length * 6 - 10);
});

test('public JSON-LD graphs resolve internal references on landing, pricing and blog', () => {
  configure();
  const documents = [
    ...PUBLIC_MARKETING_LOCALES.flatMap((locale) => [buildProductLandingJsonLd(locale), buildPricingJsonLd(locale)]),
    buildBlogIndexJsonLd(),
    buildBlogPostJsonLd(listBlogPosts()[0]),
  ];
  for (const document of documents) {
    const graph = JSON.parse(document)['@graph'];
    const ids = new Set(graph.map((node) => node['@id']).filter(Boolean));
    assert.ok(ids.has('https://30grow.com/#organization'));
    assert.ok(ids.has('https://3035tech.com/#organization'));
    assert.ok(ids.has('https://30grow.com/#website'));
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      if (value['@id']) assert.ok(ids.has(value['@id']), value['@id']);
      Object.values(value).forEach(visit);
    };
    graph.forEach(visit);
  }
});


test('solution previews match the module shown and do not reuse another module for DP', async () => {
  configure();
  const { SOLUTION_SCREENSHOTS } = await import('../../lib/marketing/product-screenshots.js');
  const { existsSync } = await import('node:fs');
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    SOLUTION_SCREENSHOTS.forEach((image, index) => {
      const metadata = buildSolutionMetadata(locale, index);
      if (image) {
        assert.ok(existsSync(new URL(`../../public${image.src}`, import.meta.url)));
        assert.equal(metadata.openGraph.images[0].url, `https://30grow.com${image.src}`);
        assert.equal(metadata.twitter.images[0], metadata.openGraph.images[0].url);
      } else {
        assert.match(metadata.openGraph.images[0].url, /brand\/logo-512\.png$/);
      }
    });
  }
});


test('regional solution duplicates consolidate without losing regional routes or hreflang', () => {
  configure();
  const entries = publicMarketingSitemapEntries('https://30grow.com');
  for (const [regional, preferred] of [['pt-PT', 'pt-BR'], ['es-ES', 'es-419']]) {
    for (let index = 0; index < SOLUTION_SLUGS.length; index++) {
      const regionalUrl = `https://30grow.com${publicMarketingPath(regional, 'solution', index)}`;
      const canonical = `https://30grow.com${publicMarketingPath(preferred, 'solution', index)}`;
      const metadata = buildSolutionMetadata(regional, index);
      assert.equal(metadata.alternates.canonical, canonical);
      assert.equal(metadata.openGraph.url, canonical);
      assert.equal(metadata.alternates.languages[publicHreflang(regional)], regionalUrl);
      assert.ok(publicMarketingRoute(new URL(regionalUrl).pathname));
      assert.ok(!entries.some((entry) => entry.url === regionalUrl));
      assert.ok(entries.some((entry) => entry.url === canonical));
    }
    // Home and pricing retain regional identity and pricing.
    assert.equal(buildPricingMetadata(regional).alternates.canonical, `https://30grow.com${publicMarketingPath(regional, '/pricing')}`);
  }
});
