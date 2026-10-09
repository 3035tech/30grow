import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { publicSiteBaseUrl } from '../../lib/public-site-url.js';
import { productLandingAbsoluteUrl } from '../../lib/product-landing-seo.js';
import { publicVacancyAbsoluteUrl } from '../../lib/public-job-url.js';

const saved = { site: process.env.NEXT_PUBLIC_SITE_URL, app: process.env.NEXT_PUBLIC_APP_URL };

afterEach(() => {
  for (const [key, value] of [['NEXT_PUBLIC_SITE_URL', saved.site], ['NEXT_PUBLIC_APP_URL', saved.app]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('public site URL prefers NEXT_PUBLIC_SITE_URL and trims the trailing slash', () => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.30grow.com';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://30grow.com/';
  assert.equal(publicSiteBaseUrl(), 'https://30grow.com');
  assert.equal(productLandingAbsoluteUrl('/blog'), 'https://30grow.com/blog');
  assert.match(publicVacancyAbsoluteUrl({ vacancySlug: 'dev', vacancyId: 7 }), /^https:\/\/30grow\.com\/jobs\//);
});

test('falls back to NEXT_PUBLIC_APP_URL, then to relative paths', () => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.30grow.com';
  assert.equal(publicSiteBaseUrl(), 'https://30grow.com');
  delete process.env.NEXT_PUBLIC_APP_URL;
  assert.equal(publicSiteBaseUrl(), '');
  assert.equal(productLandingAbsoluteUrl('/pricing'), '/pricing');
});
