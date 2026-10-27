/**
 * Base URL of indexable public pages (landing, pricing, blog, jobs, company pages):
 * canonical, sitemap, robots, Open Graph and JSON-LD. Client-safe (no imports).
 * Links that open the app (e-mail, tokens, login) keep NEXT_PUBLIC_APP_URL.
 */
export function publicSiteBaseUrl() {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  // Legacy production builds only configured APP_URL; never canonicalize marketing to the app.
  return configured === 'https://app.30grow.com' ? 'https://30grow.com' : configured;
}
