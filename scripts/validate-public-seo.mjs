import assert from 'node:assert/strict';
import { PUBLIC_MARKETING_LOCALES, SOLUTION_SLUGS, publicMarketingPath, publicHreflang } from '../lib/public-marketing-paths.js';

const base = (process.argv[2] || 'http://127.0.0.1:3032').replace(/\/$/, '');
const canonicalBase = (process.env.SEO_CANONICAL_BASE || 'https://30grow.com').replace(/\/$/, '');
const htmlLang = (locale) => locale === 'en' ? 'en-US' : locale;
const requests = PUBLIC_MARKETING_LOCALES.flatMap((locale) => [
  { locale, path: publicMarketingPath(locale) },
  { locale, path: publicMarketingPath(locale, '/pricing') },
  ...SOLUTION_SLUGS.map((_, index) => ({ locale, path: publicMarketingPath(locale, 'solution', index) })),
]);

async function get(path, headers = {}) {
  const response = await fetch(`${base}${path}`, { redirect: 'manual', headers, signal: AbortSignal.timeout(30000) });
  return { response, html: await response.text() };
}
for (let offset = 0; offset < requests.length; offset += 4) {
  await Promise.all(requests.slice(offset, offset + 4).map(async ({ locale, path }) => {
    const { response, html } = await get(path, { cookie: 'NEXT_LOCALE=de-DE', 'accept-language': 'en-US', 'x-public-locale': 'en' });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-robots-tag'), null, path);
    assert.ok(html.includes(`<html lang="${htmlLang(locale)}"`), `${path}: SSR language must follow URL`);
    assert.match(html, /<meta name="robots" content="index, follow"/);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];
    assert.equal(canonical.replace(/\/$/, ''), `${canonicalBase}${path}`.replace(/\/$/, ''), path);
    assert.equal((html.match(/rel="alternate" hrefLang=/g) || []).length, 8, `${path}: reciprocal hreflang`);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, path);
    assert.match(html, /<script[^>]*type="application\/ld\+json"/);
    for (const other of PUBLIC_MARKETING_LOCALES) assert.ok(html.includes(`hrefLang="${publicHreflang(other)}"`), path);
  }));
}
const { html: sitemap, response: sitemapResponse } = await get('/sitemap.xml');
assert.equal(sitemapResponse.status, 200);
for (const { path } of requests) assert.ok(sitemap.includes(`<loc>${canonicalBase}${path}</loc>`), path);
assert.doesNotMatch(sitemap, /app\.30grow\.com|\/signup<|\/dashboard</);
const { html: robots } = await get('/robots.txt');
assert.ok(robots.includes(`Sitemap: ${canonicalBase}/sitemap.xml`));
for (const path of ['/dashboard', '/login', '/api/', '/prep/']) assert.ok(robots.includes(`Disallow: ${path}`));
const legacy = await get('/pricing?lang=fr&utm_source=seo-validation');
assert.equal(legacy.response.status, 308);
assert.equal(new URL(legacy.response.headers.get('location'), base).pathname, '/fr/pricing');
assert.equal(new URL(legacy.response.headers.get('location'), base).searchParams.get('utm_source'), 'seo-validation');
for (const path of ['/en/dashboard', '/fr/api/admin', '/en/solutions/not-a-solution']) {
  const { response } = await get(path);
  assert.equal(response.status, 404, path);
}
const admin = await get('/api/admin/analytics/metrics');
assert.equal(admin.response.status, 401);
assert.match(admin.response.headers.get('x-robots-tag'), /noindex/);
const reset = await get('/a/set-password');
assert.match(reset.response.headers.get('x-robots-tag'), /noindex/);
if (new URL(base).hostname === '127.0.0.1') {
  for (const host of ['app.30grow.com', 'www.30grow.com']) {
    const alias = await get('/en/solutions/recruiting?utm_source=alias', { 'x-forwarded-host': host });
    assert.equal(alias.response.status, 308);
    assert.equal(alias.response.headers.get('location'), `${canonicalBase}/en/solutions/recruiting?utm_source=alias`);
    const auth = await get('/a/set-password', { 'x-forwarded-host': host });
    assert.equal(auth.response.status, 200);
    assert.equal(auth.response.headers.get('location'), null);
  }
} else if (new URL(base).hostname === '30grow.com') {
  for (const host of ['app.30grow.com', 'www.30grow.com']) {
    const alias = await fetch(`https://${host}/en/solutions/recruiting`, { redirect: 'manual' });
    assert.equal(alias.status, 308, host);
    assert.equal(alias.headers.get('location'), `${canonicalBase}/en/solutions/recruiting`);
  }
}
console.log(`SEO HTTP validation passed: ${requests.length} marketing URLs, sitemap, hreflang, legacy language redirects and private-route protections.`);
