import Link from 'next/link';
import { BrandMark } from './BrandMark';
import { ContentEnter } from './AppLoading';
import { PRIVACY_CONTACT_EMAIL } from '../../lib/public-legal.js';

export function PublicLegalDocument({ copy }) {
  const relatedHref = copy.kind === 'privacy' ? '/terms' : '/privacy';
  const relatedLabel = copy.kind === 'privacy' ? copy.common.terms : copy.common.privacy;

  return (
    <div className="min-h-screen bg-canvas font-ui text-ink">
      <header className="border-b border-ink/8 bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" aria-label={copy.common.back} className="no-underline"><BrandMark size={30} withWordmark /></Link>
          <Link href="/" className="inline-flex min-h-touch items-center text-sm font-semibold text-brand-700 no-underline hover:text-brand-800">
            {copy.common.back}
          </Link>
        </div>
      </header>

      <ContentEnter animKey={`${copy.kind}-${copy.locale}`}>
        <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
          <article className="overflow-hidden rounded-card border border-ink/10 bg-surface shadow-card">
            <header className="border-b border-ink/8 px-6 py-8 sm:px-10 sm:py-10">
              <p className="m-0 font-mono text-2xs uppercase tracking-[0.2em] text-brand-600">30Grow · 3035Tech</p>
              <h1 className="mb-0 mt-4 font-display text-4xl font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-5xl">{copy.document.title}</h1>
              <p className="mb-0 mt-4 max-w-3xl text-base leading-7 text-ink-muted">{copy.document.intro}</p>
              <p className="mb-0 mt-5 font-mono text-xs text-ink-faint">{copy.common.version}</p>
            </header>

            <div className="grid gap-10 px-6 py-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-10">
                {copy.document.sections.map((section) => (
                  <section key={section.title}>
                    <h2 className="m-0 font-display text-2xl font-semibold text-ink">{section.title}</h2>
                    {section.paragraphs?.map((paragraph) => (
                      <p key={paragraph} className="mb-0 mt-4 text-sm leading-7 text-ink-muted">{paragraph}</p>
                    ))}
                    {section.bullets ? (
                      <ul className="mb-0 mt-4 space-y-3 pl-5 text-sm leading-7 text-ink-muted">
                        {section.bullets.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    ) : null}
                    {section.links?.map(({ href, label }) => <a key={href} href={href} className="mt-4 inline-block text-sm font-semibold text-brand-700 underline underline-offset-4">{label}</a>)}
                  </section>
                ))}
              </div>

              <aside className="self-start rounded-card border border-brand-300/50 bg-brand-50 p-5 lg:sticky lg:top-6">
                <p className="m-0 font-mono text-2xs uppercase tracking-[0.16em] text-brand-700">{copy.common.contactLabel}</p>
                <a className="mt-3 block break-all text-sm font-semibold text-brand-800 underline-offset-2 hover:underline" href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>
                  {PRIVACY_CONTACT_EMAIL}
                </a>
                <p className="mb-0 mt-3 text-xs leading-5 text-ink-muted">{copy.common.contactHint}</p>
                <div className="mt-5 border-t border-brand-300/50 pt-4">
                  <span className="block text-xs text-ink-faint">{copy.common.related}</span>
                  <Link href={relatedHref} className="mt-2 inline-flex min-h-touch items-center text-sm font-semibold text-brand-700 no-underline hover:text-brand-800">
                    {relatedLabel}
                  </Link>
                </div>
              </aside>
            </div>
          </article>
        </main>
      </ContentEnter>
    </div>
  );
}
