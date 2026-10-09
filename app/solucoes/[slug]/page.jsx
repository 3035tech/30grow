import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { normalizeLocale, localeHtmlLang } from '../../../lib/i18n';
import { getProductLandingCopy, getPublicHeaderCopy, productLandingAbsoluteUrl } from '../../../lib/product-landing-seo';
import { PUBLIC_MARKETING_LOCALES, publicMarketingPath } from '../../../lib/public-marketing-paths';
import { getPublicSolutions, solutionCopy, buildSolutionMetadata } from '../../../lib/public-solutions';
import { PublicSiteHeaderWithLocale } from '../../_components/PublicSiteHeader';
import { PublicLanguageLinks } from '../../_components/PublicLanguageLinks';

async function pageData(params) {
  const { slug } = await params;
  const publicLocale = (await headers()).get('x-public-locale');
  if (!publicLocale) notFound();
  const locale = normalizeLocale(publicLocale);
  const index = getPublicSolutions(locale).findIndex((item) => item.path.endsWith(`/${slug}`));
  if (index < 0) notFound();
  return { index, locale };
}

export async function generateMetadata({ params }) {
  const { index, locale } = await pageData(params);
  return buildSolutionMetadata(locale, index);
}

export default async function SolutionPage({ params }) {
  const { index, locale } = await pageData(params);
  const solutions = getPublicSolutions(locale);
  const solution = solutions[index];
  const copy = getProductLandingCopy(locale);
  const labels = solutionCopy(locale);
  const root = productLandingAbsoluteUrl('/');
  const url = productLandingAbsoluteUrl(solution.path);
  const home = publicMarketingPath(locale);
  const nonce = (await headers()).get('x-nonce') || undefined;
  const headerCopyByLocale = Object.fromEntries(PUBLIC_MARKETING_LOCALES.map((loc) => [loc, getPublicHeaderCopy(loc)]));
  const jsonLd = {
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: solution.title, description: solution.body, inLanguage: localeHtmlLang(locale), isPartOf: { '@id': `${root}#website` }, about: { '@id': `${root}#software` } },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: '30Grow', item: productLandingAbsoluteUrl(home) },
        { '@type': 'ListItem', position: 2, name: solution.title, item: url },
      ] },
    ],
  };
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <PublicSiteHeaderWithLocale initialLocale={locale} copyByLocale={headerCopyByLocale} />
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <nav className="mb-8 text-sm text-ink-muted" aria-label="Breadcrumb">
          <Link href={home} className="text-brand-700">30Grow</Link> / <span aria-current="page">{solution.title}</span>
        </nav>
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-brand-700">{labels.label}</p>
          <h1 className="font-display text-3xl font-semibold leading-tight sm:text-5xl">{solution.title}</h1>
          <p className="mt-6 text-lg leading-8 text-ink-muted">{solution.body}</p>
        </header>
        <section className="mt-12" aria-labelledby="features-title">
          <h2 id="features-title" className="font-display text-2xl font-semibold">{labels.features}</h2>
          <ul className="mt-5 grid list-disc gap-x-10 gap-y-4 pl-5 leading-7 text-ink-muted sm:grid-cols-2">
            {solution.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section className="mt-12 rounded-card border border-line bg-surface p-6" aria-labelledby="journey-title">
          <h2 id="journey-title" className="font-display text-2xl font-semibold">{labels.journey}</h2>
          <ol className="mt-5 grid list-decimal gap-6 pl-5 sm:grid-cols-2">
            {copy.journeyStages.map((stage) => <li key={stage.title}><h3 className="text-base font-semibold">{stage.title}</h3><p className="mt-2 leading-7 text-ink-muted">{stage.body}</p></li>)}
          </ol>
          <p className="mt-6 text-sm leading-6 text-ink-muted">{copy.footerLegal}</p>
        </section>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link href="/signup" className="rounded-control bg-action px-5 py-3 font-semibold text-action-ink">{copy.ctaEarly}</Link>
          <Link href={publicMarketingPath(locale, '/pricing')} className="rounded-control border border-line px-5 py-3 font-semibold">{copy.footerPricing}</Link>
        </div>
        <section className="mt-14 border-t border-line pt-8" aria-labelledby="related-title">
          <h2 id="related-title" className="font-display text-2xl font-semibold">{labels.related}</h2>
          <ul className="mt-5 grid list-none gap-4 p-0 sm:grid-cols-2">
            {solutions.filter((item) => item.index !== index).map((item) => <li key={item.path}><Link className="text-brand-700 underline underline-offset-4" href={item.path}>{item.title}</Link></li>)}
          </ul>
        </section>
      </main>
      <PublicLanguageLinks locale={locale} page="solution" solutionIndex={index} />
    </div>
  );
}
