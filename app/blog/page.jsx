import { headers } from 'next/headers';
import { t } from '../../lib/i18n';
import { buildBlogIndexJsonLd, buildBlogIndexMetadata, BLOG_CONTENT_LOCALE, listBlogPosts } from '../../lib/blog/index.js';
import { BlogBreadcrumb, BlogShell } from './BlogShell';
import { BlogPostCard } from '../_components/BlogPostCard';

export function generateMetadata() {
  return buildBlogIndexMetadata();
}

export default async function BlogIndexPage() {
  const nonce = (await headers()).get('x-nonce') || undefined;
  const locale = BLOG_CONTENT_LOCALE;
  const posts = listBlogPosts();
  return (
    <BlogShell locale={locale}>
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: buildBlogIndexJsonLd() }} />
      <BlogBreadcrumb locale={locale} items={[{ label: t(locale, 'blog.navBlog') }]} />
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
