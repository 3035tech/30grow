import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, LOCALES, normalizeLocale } from '../lib/i18n';
import {
  buildProductLandingJsonLd,
  buildProductLandingMetadata,
  getProductLandingCopy,
} from '../lib/product-landing-seo';
import { BLOG_LANDING_CAP, listBlogPosts } from '../lib/blog/index.js';
import ProductLandingClient from './_components/ProductLandingClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  return buildProductLandingMetadata(locale);
}

export default async function HomePage() {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const copyByLocale = Object.fromEntries(LOCALES.map((loc) => [loc, getProductLandingCopy(loc)]));
  const jsonLd = buildProductLandingJsonLd(locale);
  const blogPosts = listBlogPosts({ limit: BLOG_LANDING_CAP }).map(({ slug, path, title, description, categoryLabel, publishedAt, publishedLabel, readingMinutes }) => ({
    slug, path, title, description, categoryLabel, publishedAt, publishedLabel, readingMinutes,
  }));

  return (
    <>
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <ProductLandingClient copyByLocale={copyByLocale} locale={locale} blogPosts={blogPosts} analyticsId={process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID ?? 'G-3NCBE66VM9'} nonce={nonce} />
    </>
  );
}
