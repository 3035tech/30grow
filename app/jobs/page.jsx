import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, t, localeHtmlLang } from '../../lib/i18n';
import { normalizeEmploymentType } from '../../lib/vacancy-employment-type';
import { normalizeWorkplaceModality } from '../../lib/vacancy-workplace';
import {
  defaultPublicOgImageUrl,
  listOpenPublicVacancies,
  PUBLIC_JOB_PATH_PREFIX,
} from '../../lib/public-vacancy-posting';
import {
  aggregatorMinCount,
  listPublicCityCounts,
  resolveRemoteAggregator,
} from '../../lib/public-job-aggregators';
import { PublicVacanciesIndexView } from '../_components/PublicVacancyPosting';
import { publicSiteBaseUrl } from '../../lib/public-site-url.js';

export async function generateMetadata({ searchParams } = {}) {
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const resolvedSearchParams = await searchParams;
  const q = String(resolvedSearchParams?.q || '').trim();
  const title = q
    ? t(locale, 'publicVacancy.indexTitleFiltered', { q: q.slice(0, 40) })
    : t(locale, 'publicVacancy.indexTitle');
  const description = t(locale, 'publicVacancy.indexIntro');
  const base = publicSiteBaseUrl();
  const url = base ? `${base}${PUBLIC_JOB_PATH_PREFIX}` : PUBLIC_JOB_PATH_PREFIX;
  const ogImage = defaultPublicOgImageUrl();
  return {
    metadataBase: base ? new URL(base) : undefined,
    title,
    description,
    alternates: { canonical: url },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-snippet': -1 },
    },
    openGraph: {
      type: 'website',
      url,
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

export default async function PublicJobsIndexPage(props) {
  const searchParams = await props.searchParams;
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const q = String(searchParams?.q || '').trim().slice(0, 120);
  const employmentType = normalizeEmploymentType(searchParams?.employmentType);
  const workplaceModality = normalizeWorkplaceModality(searchParams?.workplaceModality);
  const pageRaw = parseInt(String(searchParams?.page || '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const [result, cityChips, remoteAggregator] = await Promise.all([
    listOpenPublicVacancies({
      q: q || null,
      employmentType,
      workplaceModality,
      page,
      pageSize: 12,
      includeTotal: true,
    }),
    listPublicCityCounts({ minCount: aggregatorMinCount(), limit: 5 }),
    resolveRemoteAggregator().catch(() => ({ ok: false })),
  ]);

  return (
    <PublicVacanciesIndexView
      locale={locale}
      items={result.items}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{
        q,
        employmentType: employmentType || '',
        workplaceModality: workplaceModality || '',
      }}
      cityChips={cityChips}
      showRemoteChip={remoteAggregator.ok}
    />
  );
}
