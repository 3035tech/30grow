import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Icon } from '../../_components/Icon';
import { LOCALE_COOKIE, normalizeLocale, t } from '../../../lib/i18n';
import {
  BLOG_CONTENT_LOCALE,
  buildBlogPostJsonLd,
  buildBlogPostMetadata,
  formatBlogDate,
  getBlogPost,
  listBlogPosts,
  relatedBlogPosts,
} from '../../../lib/blog/index.js';
import { BlogBreadcrumb, BlogShell } from '../BlogShell';
import { CollapsibleBlock } from '../../_components/CollapsibleBlock';
import { BlogPostCard } from '../../_components/BlogPostCard';

export const dynamicParams = false;

export function generateStaticParams() {
  return listBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata(props) {
  const { slug } = await props.params;
  const post = getBlogPost(slug);
  return post ? buildBlogPostMetadata(post) : {};
}

export default async function BlogPostPage(props) {
  const { slug } = await props.params;
  const post = getBlogPost(slug);
  if (!post) notFound();
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const related = relatedBlogPosts(post);
  const toc = post.sections.map((section) => (
    <li key={section.id}>
      <a href={`#${section.id}`} className="text-sm leading-5 text-ink-muted no-underline hover:text-ink">{section.heading}</a>
    </li>
  ));
  const updated = post.updatedAt && post.updatedAt !== post.publishedAt ? post.updatedAt : null;

  return (
    <BlogShell locale={locale}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: buildBlogPostJsonLd(post) }} />
      <BlogBreadcrumb locale={locale} items={[{ href: '/blog', label: t(locale, 'blog.navBlog') }, { label: post.categoryLabel }]} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px]">
        <article className="min-w-0 max-w-3xl">
          <header>
            <p className="m-0 font-ui text-2xs font-medium text-brand-600">{post.categoryLabel}</p>
            <h1 className="mb-0 mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-4xl">{post.title}</h1>
            <p className="mb-0 mt-4 font-ui text-xs text-ink-faint">
              <time dateTime={post.publishedAt}>{post.publishedLabel}</time>
              {updated ? <> · {t(locale, 'blog.updatedOn', { date: formatBlogDate(updated) })}</> : null}
              {' · '}
              {t(locale, 'blog.readMinutes', { n: post.readingMinutes })}
            </p>
            {locale !== BLOG_CONTENT_LOCALE ? <p className="mb-0 mt-2 text-xs text-ink-faint">{t(locale, 'blog.contentLanguageNote')}</p> : null}
            <p className="mb-0 mt-6 text-lg leading-8 text-ink-muted">{post.intro}</p>
          </header>

          <nav className="mt-8 lg:hidden" aria-label={t(locale, 'blog.inThisArticle')}>
            <CollapsibleBlock locale={locale} variant="card" title={t(locale, 'blog.inThisArticle')} count={post.sections.length}>
              <ol className="mb-0 mt-3 list-none space-y-2 px-3 pb-1">
                {toc}
              </ol>
            </CollapsibleBlock>
          </nav>

          {post.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="mt-10">
              <h2 id={section.id} className="m-0 scroll-mt-24 font-display text-2xl font-semibold leading-snug text-ink">{section.heading}</h2>
              {(section.paragraphs || []).map((paragraph, index) => (
                <p key={index} className="mb-0 mt-4 text-base leading-7 text-ink-muted">{paragraph}</p>
              ))}
              {section.bullets?.length ? (
                <ul className="mb-0 mt-4 list-none space-y-2.5 p-0">
                  {section.bullets.map((item) => (
                    <li key={item} className="flex gap-3 text-base leading-7 text-ink-muted">
                      <Icon name="check" className="mt-1.5 h-4 w-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          {post.takeaways?.length ? (
            <aside className="mt-12 rounded-card border border-brand-300/50 bg-brand-50 p-6" aria-labelledby="pontos-principais">
              <h2 id="pontos-principais" className="m-0 font-display text-xl font-semibold text-ink">{t(locale, 'blog.takeaways')}</h2>
              <ul className="mb-0 mt-4 list-none space-y-2.5 p-0">
                {post.takeaways.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6 text-ink-muted">
                    <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-brand-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}

          {post.faq?.length ? (
            <section className="mt-12" aria-labelledby="perguntas-frequentes">
              <h2 id="perguntas-frequentes" className="m-0 font-display text-2xl font-semibold text-ink">{t(locale, 'blog.faqTitle')}</h2>
              <div className="mt-4 divide-y divide-ink/10 border-y border-ink/10">
                {post.faq.map((faq) => (
                  <details key={faq.q} className="group py-1">
                    <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                      {faq.q}
                      <Icon name="chevronDown" className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" />
                    </summary>
                    <p className="mb-5 mt-0 text-sm leading-6 text-ink-muted">{faq.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-12 rounded-card bg-navy p-6 text-white sm:p-8" aria-labelledby="blog-cta">
            <h2 id="blog-cta" className="m-0 font-display text-2xl font-semibold text-white">{t(locale, 'blog.ctaTitle')}</h2>
            <p className="mb-0 mt-3 text-base leading-7 text-white/70">{t(locale, 'blog.ctaBody')}</p>
            <Link href="/signup" className="mt-6 inline-flex min-h-touch items-center justify-center rounded-control bg-white px-6 py-3 font-semibold text-brand-800 no-underline hover:bg-brand-50">
              {t(locale, 'blog.ctaButton')}
            </Link>
          </section>
        </article>

        <aside className="hidden lg:block" aria-label={t(locale, 'blog.inThisArticle')}>
          <nav className="sticky top-24 rounded-card border border-ink/10 bg-surface p-5">
            <p className="m-0 font-ui text-2xs font-medium text-ink-label">{t(locale, 'blog.inThisArticle')}</p>
            <ol className="mb-0 mt-3 list-none space-y-2 p-0">
              {toc}
            </ol>
          </nav>
        </aside>
      </div>

      {related.length ? (
        <section className="mt-16 border-t border-ink/8 pt-10" aria-labelledby="leia-tambem">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="leia-tambem" className="m-0 font-display text-2xl font-semibold text-ink">{t(locale, 'blog.related')}</h2>
            <Link href="/blog" className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800">{t(locale, 'blog.allPosts')}</Link>
          </div>
          <ul className="m-0 mt-6 grid list-none gap-4 p-0 md:grid-cols-3">
            {related.map((item) => (
              <li key={item.slug}>
                <BlogPostCard post={item} headingLevel="h3" readMinutesLabel={t(locale, 'blog.readMinutes', { n: item.readingMinutes })} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </BlogShell>
  );
}
