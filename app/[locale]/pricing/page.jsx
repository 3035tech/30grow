import { notFound } from 'next/navigation';
import PricingPage from '../../pricing/page';
import { publicMarketingRoute } from '../../../lib/public-marketing-paths';
import { buildPricingMetadata } from '../../../lib/pricing-plans';

async function routeLocale(params) {
  const { locale } = await params;
  const route = publicMarketingRoute(`/${locale}/pricing`);
  if (!route) notFound();
  return route.locale;
}

export async function generateMetadata({ params }) {
  return buildPricingMetadata(await routeLocale(params));
}

export default async function LocalizedPricingPage({ params }) {
  await routeLocale(params);
  return PricingPage();
}
