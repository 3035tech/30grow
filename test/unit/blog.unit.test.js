import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOG_CATEGORY,
  BLOG_LANDING_CAP,
  BLOG_PATH,
  buildBlogIndexJsonLd,
  buildBlogIndexMetadata,
  buildBlogPostJsonLd,
  buildBlogPostMetadata,
  getBlogPost,
  listBlogPosts,
  relatedBlogPosts,
} from '../../lib/blog/index.js';
import { isCrawlerNoIndexPath } from '../../lib/crawler-guard.js';
import { t } from '../../lib/i18n.js';

const EM_DASH_SPACED = ' \u2014 ';
const CATEGORIES = new Set(Object.values(BLOG_CATEGORY));

function allCopy(post) {
  return [
    post.title,
    post.description,
    post.intro,
    ...post.sections.flatMap((s) => [s.heading, ...(s.paragraphs || []), ...(s.bullets || [])]),
    ...(post.takeaways || []),
    ...(post.faq || []).flatMap((f) => [f.q, f.a]),
  ];
}

test('blog has at least 10 posts with unique slugs, newest first', () => {
  const posts = listBlogPosts();
  assert.ok(posts.length >= 10);
  assert.equal(new Set(posts.map((p) => p.slug)).size, posts.length);
  for (let i = 1; i < posts.length; i += 1) {
    assert.ok(posts[i - 1].publishedAt >= posts[i].publishedAt);
  }
  assert.equal(listBlogPosts({ limit: BLOG_LANDING_CAP }).length, BLOG_LANDING_CAP);
});

test('each post has SEO-ready fields and valid category', () => {
  for (const post of listBlogPosts()) {
    assert.match(post.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, post.slug);
    assert.equal(post.path, `${BLOG_PATH}/${post.slug}`);
    assert.ok(CATEGORIES.has(post.category), `${post.slug} category`);
    assert.ok(post.title.length <= 90, `${post.slug} title length`);
    assert.ok(post.description.length >= 70 && post.description.length <= 170, `${post.slug} description length ${post.description.length}`);
    assert.match(post.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(post.keywords.length >= 3);
    assert.ok(post.sections.length >= 3);
    assert.ok(post.faq.length >= 2);
    assert.ok(post.readingMinutes >= 1);
    assert.equal(new Set(post.sections.map((s) => s.id)).size, post.sections.length, `${post.slug} section ids unique`);
  }
});

test('post copy never uses spaced em dash', () => {
  for (const post of listBlogPosts()) {
    for (const text of allCopy(post)) {
      assert.ok(!text.includes(EM_DASH_SPACED), `${post.slug}: ${text.slice(0, 60)}`);
    }
  }
});

test('getBlogPost and relatedBlogPosts', () => {
  const [first] = listBlogPosts();
  assert.equal(getBlogPost(first.slug)?.slug, first.slug);
  assert.equal(getBlogPost('nao-existe'), null);
  const related = relatedBlogPosts(first);
  assert.equal(related.length, 3);
  assert.ok(related.every((p) => p.slug !== first.slug));
});

test('metadata and JSON-LD shape', () => {
  const index = buildBlogIndexMetadata();
  assert.ok(index.alternates.canonical.endsWith(BLOG_PATH));
  assert.equal(index.robots.index, true);
  const indexLd = JSON.parse(buildBlogIndexJsonLd());
  assert.ok(indexLd['@graph'].some((n) => n['@type'] === 'Blog'));

  const post = listBlogPosts()[0];
  const meta = buildBlogPostMetadata(post);
  assert.equal(meta.openGraph.type, 'article');
  assert.ok(meta.alternates.canonical.endsWith(post.path));
  const ld = JSON.parse(buildBlogPostJsonLd(post));
  const types = ld['@graph'].map((n) => n['@type']);
  for (const type of ['BlogPosting', 'BreadcrumbList', 'FAQPage']) assert.ok(types.includes(type), type);
});

test('blog and pricing stay indexable', () => {
  assert.equal(isCrawlerNoIndexPath('/blog'), false);
  assert.equal(isCrawlerNoIndexPath(`/blog/${listBlogPosts()[0].slug}`), false);
  assert.equal(isCrawlerNoIndexPath('/pricing'), false);
});

test('blog chrome i18n exists in all locales without spaced em dash', () => {
  const keys = ['navBlog', 'indexTitle', 'indexLead', 'readMinutes', 'takeaways', 'faqTitle', 'ctaTitle', 'ctaButton', 'related', 'allPosts', 'landingTitle'];
  for (const locale of ['pt-BR', 'en', 'fr-FR', 'de-DE']) {
    for (const key of keys) {
      const value = t(locale, `blog.${key}`, { n: 3 });
      assert.ok(value && value !== `blog.${key}`, `${locale} blog.${key}`);
      assert.ok(!value.includes(EM_DASH_SPACED), `${locale} blog.${key}`);
    }
  }
});
