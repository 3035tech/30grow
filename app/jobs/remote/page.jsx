import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LOCALE_COOKIE, normalizeLocale, t, localeHtmlLang } from '../../../lib/i18n';
import {
  listAggregatorVacancies,
  resolveRemoteAggregator,
} from '../../../lib/public-job-aggregators';
import { defaultPublicOgImageUrl } from '../../../lib/public-vacancy-posting';
import { publicRemoteAggregatorPath } from '../../../lib/public-job-url';
import { PublicVacanciesIndexView } from '../../_components/PublicVacancyPosting';
import { publicSiteBaseUrl } from '../../../lib/public-site-url.js';

export async function generateMetadata({ searchParams } = {}) {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const resolved = await resolveRemoteAggregator();
  if (!resolved.ok) {
    return {
      title: t(locale, 'publicVacancy.aggregatorNotFoundTitle'),
      robots: { index: false, follow: false },
    };
  }
  const title = t(locale, 'publicVacancy.aggregatorRemoteTitle');
  const description = t(locale, 'publicVacancy.aggregatorRemoteDescription');
  const base = publicSiteBaseUrl();
  const path = publicRemoteAggregatorPath();
  const url = base ? `${base}${path}` : path;
  const ogImage = defaultPublicOgImageUrl();
  const pageRaw = parseInt(String(searchParams?.page || '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const canonical = page > 1 ? `${url}?page=${page}` : url;
  return {
    metadataBase: base ? new URL(base) : undefined,
    title,
    description,
    alternates: { canonical },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-snippet': -1 },
    },
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      description,
      siteName: '30Grow',
      locale: localeHtmlLang(locale).replace('-', '_'),
      images: ogImage ? [{ url: ogImage, width: 512, height: 512, alt: '30Grow' }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function PublicRemoteJobsPage(props) {
  const searchParams = await props.searchParams;
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const resolved = await resolveRemoteAggregator();
  if (!resolved.ok) notFound();

  const pageRaw = parseInt(String(searchParams?.page || '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const result = await listAggregatorVacancies('remote', { page, pageSize: 12 });
  if ((Number(result.total) || 0) < 1) notFound();

  return (
    <PublicVacanciesIndexView
      locale={locale}
      items={result.items}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      title={t(locale, 'publicVacancy.aggregatorRemoteTitle')}
      intro={t(locale, 'publicVacancy.aggregatorRemoteIntro')}
      basePath={publicRemoteAggregatorPath()}
      showSearchForm={false}
      showJobAlert={false}
    />
  );
}
