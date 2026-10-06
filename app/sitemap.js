import { listSitemapPublicEntries } from '../lib/public-vacancy-posting';
import { listSitemapAggregatorEntries } from '../lib/public-job-aggregators';
import { BLOG_PATH, listBlogPosts } from '../lib/blog/index.js';
import { publicSiteBaseUrl } from '../lib/public-site-url.js';

/**
 * Sitemap: / + /pricing + /blog (+ posts) + /jobs + aggregators (remote/city with enough volume) + vagas públicas indexáveis.
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 */
export default async function sitemap() {
  const base = publicSiteBaseUrl();
  if (!base) return [];

  const now = new Date();
  const blogPosts = listBlogPosts();
  const entries = [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${base}/llms.txt`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.4,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${base}${BLOG_PATH}`,
      lastModified: blogPosts[0] ? new Date(blogPosts[0].updatedAt || blogPosts[0].publishedAt) : now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    ...blogPosts.map((post) => ({
      url: `${base}${post.path}`,
      lastModified: new Date(post.updatedAt || post.publishedAt),
      changeFrequency: 'monthly',
      priority: 0.6,
    })),
    {
      url: `${base}/jobs`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  try {
    const aggregators = await listSitemapAggregatorEntries({ limit: 200 });
    for (const agg of aggregators) {
      entries.push({
        url: agg.url.startsWith('http') ? agg.url : `${base}${agg.path}`,
        lastModified: agg.lastModified || now,
        changeFrequency: 'daily',
        priority: 0.65,
      });
    }
  } catch (err) {
    console.error('[sitemap] failed to list aggregators', err?.message || err);
  }

  try {
    const jobs = await listSitemapPublicEntries({ limit: 5000 });
    for (const job of jobs) {
      entries.push({
        url: job.url.startsWith('http') ? job.url : `${base}${job.path}`,
        lastModified: job.lastModified || now,
        changeFrequency: 'daily',
        priority: 0.7,
      });
    }
  } catch (err) {
    console.error('[sitemap] failed to list public vacancies', err?.message || err);
  }

  return entries;
}

export const dynamic = 'force-dynamic';
