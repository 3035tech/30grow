/**
 * Blog público (`/blog`) — artigos de conteúdo para SEO da landpage.
 * Conteúdo estático em `lib/blog/articles/*.js` (pt-BR), sem banco: entra no build,
 * no sitemap e no llms.txt. Para publicar: criar o arquivo e registrar em ARTICLES.
 */

import { productLandingAbsoluteUrl, productLandingOgImageUrl, PRODUCT_LANDING_CONTACT_EMAIL } from '../product-landing-seo.js';
import { BLOG_CATEGORY, BLOG_CATEGORY_LABEL } from './categories.js';
import eneagramaNoTrabalho from './articles/eneagrama-no-trabalho.js';
import atsTesteGestao from './articles/ats-teste-de-perfil-e-gestao-de-pessoas.js';
import rubricaDeVaga from './articles/rubrica-de-vaga.js';
import entrevistaEstruturada from './articles/entrevista-estruturada-scorecard.js';
import onboarding90 from './articles/onboarding-30-60-90-dias.js';
import reuniao1a1 from './articles/reuniao-one-on-one.js';
import pdiNaPratica from './articles/pdi-plano-de-desenvolvimento-individual.js';
import climaEnps from './articles/pesquisa-de-clima-e-enps.js';
import motivadores from './articles/motivadores-no-trabalho.js';
import lgpdNoRh from './articles/lgpd-no-rh.js';

export const BLOG_PATH = '/blog';
export const BLOG_CONTENT_LOCALE = 'pt-BR';
export const BLOG_RELATED_CAP = 3;
export const BLOG_LANDING_CAP = 3;

export { BLOG_CATEGORY, BLOG_CATEGORY_LABEL };

const ARTICLES = [
  eneagramaNoTrabalho,
  atsTesteGestao,
  rubricaDeVaga,
  entrevistaEstruturada,
  onboarding90,
  reuniao1a1,
  pdiNaPratica,
  climaEnps,
  motivadores,
  lgpdNoRh,
];

const WORDS_PER_MINUTE = 200;

function articleWords(article) {
  const parts = [
    article.intro,
    ...article.sections.flatMap((s) => [s.heading, ...(s.paragraphs || []), ...(s.bullets || [])]),
    ...(article.takeaways || []),
    ...(article.faq || []).flatMap((f) => [f.q, f.a]),
  ];
  return parts.join(' ').split(/\s+/).filter(Boolean).length;
}

/** Âncora estável para o sumário (sem acento, minúsculas). */
export function blogHeadingId(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const POSTS = ARTICLES.map((article) => ({
  ...article,
  categoryLabel: BLOG_CATEGORY_LABEL[article.category] || article.category,
  readingMinutes: Math.max(1, Math.round(articleWords(article) / WORDS_PER_MINUTE)),
  path: `${BLOG_PATH}/${article.slug}`,
  publishedLabel: formatBlogDate(article.publishedAt),
  sections: article.sections.map((s) => ({ ...s, id: blogHeadingId(s.heading) })),
})).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));

const BY_SLUG = new Map(POSTS.map((p) => [p.slug, p]));

/** Mais recentes primeiro. */
export function listBlogPosts({ limit = null } = {}) {
  return limit ? POSTS.slice(0, limit) : POSTS.slice();
}

export function getBlogPost(slug) {
  return BY_SLUG.get(String(slug || '')) || null;
}

/** Mesma categoria primeiro, depois os mais recentes; nunca o próprio artigo. */
export function relatedBlogPosts(post, limit = BLOG_RELATED_CAP) {
  if (!post) return [];
  const others = POSTS.filter((p) => p.slug !== post.slug);
  const same = others.filter((p) => p.category === post.category);
  const rest = others.filter((p) => p.category !== post.category);
  return [...same, ...rest].slice(0, limit);
}

/** Data longa em pt-BR (ex.: 2 de outubro de 2026), fuso fixo para não variar por servidor. */
export function formatBlogDate(isoDate) {
  return new Intl.DateTimeFormat(BLOG_CONTENT_LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function serializeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

const BLOG_TITLE = 'Blog 30Grow: recrutamento, perfis de trabalho e gestão de pessoas';
const BLOG_DESCRIPTION =
  'Guias práticos para RH e gestores: Eneagrama no trabalho, rubrica de vaga, entrevista estruturada, onboarding, 1:1, PDI, clima, Motivadores e LGPD no RH.';

function sharedRobots() {
  return {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large', 'max-video-preview': -1 },
  };
}

export function buildBlogIndexMetadata() {
  const url = productLandingAbsoluteUrl(BLOG_PATH);
  const image = productLandingOgImageUrl();
  return {
    title: { absolute: BLOG_TITLE },
    description: BLOG_DESCRIPTION,
    keywords: [...new Set(POSTS.flatMap((p) => p.keywords))].slice(0, 30),
    alternates: { canonical: url },
    robots: sharedRobots(),
    openGraph: {
      type: 'website',
      url,
      title: BLOG_TITLE,
      description: BLOG_DESCRIPTION,
      siteName: '30Grow',
      locale: 'pt_BR',
      images: [{ url: image, width: 512, height: 512, alt: '30Grow' }],
    },
    twitter: { card: 'summary', title: BLOG_TITLE, description: BLOG_DESCRIPTION, images: [image] },
  };
}

export function buildBlogPostMetadata(post) {
  const url = productLandingAbsoluteUrl(post.path);
  const image = productLandingOgImageUrl();
  return {
    title: { absolute: `${post.title} | Blog 30Grow` },
    description: post.description,
    keywords: post.keywords,
    authors: [{ name: '3035Tech' }],
    alternates: { canonical: url },
    robots: sharedRobots(),
    openGraph: {
      type: 'article',
      url,
      title: post.title,
      description: post.description,
      siteName: '30Grow',
      locale: 'pt_BR',
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt || post.publishedAt,
      section: post.categoryLabel,
      tags: post.keywords,
      images: [{ url: image, width: 512, height: 512, alt: '30Grow' }],
    },
    twitter: { card: 'summary', title: post.title, description: post.description, images: [image] },
  };
}

function organizationRef() {
  return {
    '@type': 'Organization',
    '@id': `${productLandingAbsoluteUrl('/')}#organization`,
    name: '3035Tech',
    url: 'https://3035tech.com',
    email: PRODUCT_LANDING_CONTACT_EMAIL,
    logo: { '@type': 'ImageObject', url: productLandingOgImageUrl() },
  };
}

function breadcrumb(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: productLandingAbsoluteUrl(item.path),
    })),
  };
}

export function buildBlogIndexJsonLd() {
  const url = productLandingAbsoluteUrl(BLOG_PATH);
  return serializeJsonLd({
    '@context': 'https://schema.org',
    '@graph': [
      organizationRef(),
      {
        '@type': 'Blog',
        '@id': `${url}#blog`,
        url,
        name: BLOG_TITLE,
        description: BLOG_DESCRIPTION,
        inLanguage: BLOG_CONTENT_LOCALE,
        publisher: { '@id': `${productLandingAbsoluteUrl('/')}#organization` },
        blogPost: POSTS.map((p) => ({
          '@type': 'BlogPosting',
          headline: p.title,
          url: productLandingAbsoluteUrl(p.path),
          datePublished: p.publishedAt,
          dateModified: p.updatedAt || p.publishedAt,
        })),
      },
      breadcrumb([{ name: '30Grow', path: '/' }, { name: 'Blog', path: BLOG_PATH }]),
    ],
  });
}

export function buildBlogPostJsonLd(post) {
  const url = productLandingAbsoluteUrl(post.path);
  const orgId = `${productLandingAbsoluteUrl('/')}#organization`;
  const graph = [
    organizationRef(),
    {
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      headline: post.title,
      description: post.description,
      keywords: post.keywords.join(', '),
      articleSection: post.categoryLabel,
      inLanguage: BLOG_CONTENT_LOCALE,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt || post.publishedAt,
      timeRequired: `PT${post.readingMinutes}M`,
      image: productLandingOgImageUrl(),
      author: { '@id': orgId },
      publisher: { '@id': orgId },
      isPartOf: { '@type': 'Blog', '@id': `${productLandingAbsoluteUrl(BLOG_PATH)}#blog` },
    },
    breadcrumb([
      { name: '30Grow', path: '/' },
      { name: 'Blog', path: BLOG_PATH },
      { name: post.title, path: post.path },
    ]),
  ];
  if (post.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: post.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  return serializeJsonLd({ '@context': 'https://schema.org', '@graph': graph });
}
