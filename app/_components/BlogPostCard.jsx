import Link from 'next/link';

/** Card used by the blog index, related posts and the landing section. */
export function BlogPostCard({ post, readMinutesLabel, headingLevel = 'h2' }) {
  const Heading = headingLevel;
  return (
    <article className="relative flex h-full flex-col rounded-card border border-ink/10 bg-surface p-5 shadow-card transition-colors hover:border-brand-300 sm:p-6">
      <p className="m-0 font-ui text-2xs font-medium text-brand-600">{post.categoryLabel}</p>
      <Heading className="mb-0 mt-3 font-display text-lg font-semibold leading-snug text-ink">
        <Link href={post.path} className="text-ink no-underline after:absolute after:inset-0 hover:text-brand-700">{post.title}</Link>
      </Heading>
      <p className="mb-0 mt-3 flex-1 text-sm leading-6 text-ink-muted">{post.description}</p>
      <p className="mb-0 mt-4 font-ui text-xs text-ink-faint">
        <time dateTime={post.publishedAt}>{post.publishedLabel}</time> · {readMinutesLabel}
      </p>
    </article>
  );
}
