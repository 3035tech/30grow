import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { LOCALE_COOKIE, normalizeLocale, t, localeHtmlLang } from '../../../lib/i18n';
import {
  buildJobPostingJsonLd,
  defaultPublicOgImageUrl,
  listOpenPublicVacancies,
  parsePublicJobKey,
  postingDocumentTitle,
  postingMetaDescription,
  publicVacancyAbsoluteUrl,
  publicVacancyShowsClosedExperience,
  resolvePublicVacancyPostingById as resolveByIdRaw,
  serializeJsonLdForScript,
} from '../../../lib/public-vacancy-posting';
import { PublicVacancyPostingView } from '../../_components/PublicVacancyPosting';

/** Dedupa generateMetadata + page no mesmo request RSC. */
const resolveById = cache(resolveByIdRaw);

export async function generateMetadata(props) {
  const params = await props.params;
  const jobKey = typeof params?.jobKey === 'string' ? params.jobKey : '';
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const parsed = parsePublicJobKey(jobKey);
  if (!parsed) {
    return {
      title: t(locale, 'publicVacancy.notFoundTitle'),
      robots: { index: false, follow: false },
    };
  }

  const resolved = await resolveById(parsed.id, parsed.slug);
  if (!resolved.ok) {
    return {
      title: t(locale, 'publicVacancy.notFoundTitle'),
      robots: { index: false, follow: false },
    };
  }

  if (resolved.slugMismatch) {
    permanentRedirect(resolved.canonicalPath);
  }

  const { posting } = resolved;
  const closed = publicVacancyShowsClosedExperience(posting);
  const title = postingDocumentTitle(posting, locale);
  const description = postingMetaDescription(posting, locale);
  const url =
    posting.pageUrl ||
    publicVacancyAbsoluteUrl({ vacancySlug: posting.vacancySlug, vacancyId: posting.vacancyId });
  const indexable = Boolean(posting.publicAllowIndex) && !closed;
  const ogImage = defaultPublicOgImageUrl();

  return {
    metadataBase: url && url.startsWith('http') ? new URL(new URL(url).origin) : undefined,
    title,
    description,
    alternates: url ? { canonical: url } : undefined,
    robots: {
      index: indexable,
      follow: true,
      googleBot: {
        index: indexable,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
      },
    },
    openGraph: {
      type: 'website',
      url: url || undefined,
      title,
      description,
      siteName: '30Grow',
      locale: localeHtmlLang(locale).replace('-', '_'),
      images: ogImage
        ? [{ url: ogImage, width: 512, height: 512, alt: '30Grow' }]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function PublicJobPage(props) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const params = await props.params;
  const jobKey = typeof params?.jobKey === 'string' ? params.jobKey : '';
  const locale = normalizeLocale(await (await cookies()).get(LOCALE_COOKIE)?.value);
  const parsed = parsePublicJobKey(jobKey);
  if (!parsed) notFound();

  const resolved = await resolveById(parsed.id, parsed.slug);
  if (!resolved.ok) notFound();
  if (resolved.slugMismatch) permanentRedirect(resolved.canonicalPath);

  const { posting } = resolved;
  const closed = publicVacancyShowsClosedExperience(posting);
  const related = closed
    ? await listOpenPublicVacancies({
        companyId: posting.company?.id ?? posting.companyId ?? null,
        excludeVacancyId: posting.vacancyId,
        limit: 8,
      })
    : [];

  const jsonLd =
    !closed && posting.publicAllowIndex ? buildJobPostingJsonLd(posting, locale) : null;

  return (
    <>
      {jsonLd ? (
        <script
          nonce={nonce}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(jsonLd) }}
        />
      ) : null}
      <PublicVacancyPostingView locale={locale} posting={posting} related={related} />
    </>
  );
}
