import Link from 'next/link';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, normalizeLocale, t } from '../../lib/i18n';
import { buildBlogIndexJsonLd, buildBlogIndexMetadata, BLOG_CONTENT_LOCALE, listBlogPosts } from '../../lib/blog/index.js';
import { BlogShell } from './BlogShell';
import { BlogPostCard } from '../_components/BlogPostCard';

export function generateMetadata() {
  return buildBlogIndexMetadata();
}

export default async function BlogIndexPage() {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const posts = listBlogPosts();
  return (
    <BlogShell locale={locale}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: buildBlogIndexJsonLd() }} />
      <nav aria-label={t(locale, 'blog.breadcrumbAria')} className="mb-6 font-ui text-xs text-ink-faint">
        <Link href="/" className="text-ink-muted no-underline hover:text-ink">{t(locale, 'blog.home')}</Link>
        <span className="mx-2" aria-hidden>/</span>
        <span aria-current="page">{t(locale, 'blog.navBlog')}</span>
      </nav>
      <header className="max-w-3xl">
        <h1 className="m-0 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-5xl">{t(locale, 'blog.indexTitle')}</h1>
        <p className="mb-0 mt-4 text-base leading-7 text-ink-muted sm:text-lg">{t(locale, 'blog.indexLead')}</p>
        {locale !== BLOG_CONTENT_LOCALE ? <p className="mb-0 mt-3 text-sm text-ink-faint">{t(locale, 'blog.contentLanguageNote')}</p> : null}
      </header>
      <ul className="m-0 mt-10 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
        {posts.map((post) => (
          <li key={post.slug}>
            <BlogPostCard post={post} readMinutesLabel={t(locale, 'blog.readMinutes', { n: post.readingMinutes })} />
          </li>
        ))}
      </ul>
    </BlogShell>
  );
}
