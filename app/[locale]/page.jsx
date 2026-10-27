import { notFound } from 'next/navigation';
import HomePage from '../page';
import { publicMarketingRoute } from '../../lib/marketing/public-marketing-paths';
import { buildProductLandingMetadata } from '../../lib/marketing/product-landing-seo';

async function routeLocale(params) {
  const { locale } = await params;
  const route = publicMarketingRoute(`/${locale}`);
  if (!route || route.page !== '/') notFound();
  return route.locale;
}

export async function generateMetadata({ params }) {
  return buildProductLandingMetadata(await routeLocale(params));
}

export default async function LocalizedHomePage({ params }) {
  await routeLocale(params);
  return HomePage();
}
