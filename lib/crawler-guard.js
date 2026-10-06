/**
 * Regras anti-crawler (camada 1) — robots.txt + X-Robots-Tag.
 * Não inclui /jobs nem /companies (SEO de vagas permanece indexável).
 */

/** Prefixos Disallow em robots.txt (crawlers educados). */
export const ROBOTS_DISALLOW_PREFIXES = Object.freeze([
  '/dashboard',
  '/api/',
  '/login',
  '/signup',
  '/employee/',
  '/t/',
  '/v/',
  '/assessment/',
  '/clima/',
  '/pulso/',
  '/e/',
  '/r/',
  '/a/unsubscribe',
]);

/** Prefixos que recebem X-Robots-Tag: noindex, nofollow (reforço além de <meta>). */
const NOINDEX_PREFIXES = Object.freeze([
  '/t/',
  '/v/',
  '/assessment/',
  '/clima/',
  '/pulso/',
  '/e/',
  '/r/',
  '/employee/',
  '/signup',
  '/login',
  '/dashboard',
  '/a/unsubscribe',
  '/api/',
]);

/** Paths que devem permanecer indexáveis — nunca aplicar noindex. */
function isSeoIndexablePath(pathname) {
  const p = String(pathname || '');
  if (p === '/jobs' || p.startsWith('/jobs/')) return true;
  if (p.startsWith('/companies/')) return true;
  if (p === '/blog' || p.startsWith('/blog/') || p === '/pricing') return true;
  if (p === '/sitemap.xml' || p === '/robots.txt' || p === '/llms.txt') return true;
  return false;
}

function matchesPrefix(pathname, prefix) {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** @param {string} pathname */
export function isCrawlerNoIndexPath(pathname) {
  const p = String(pathname || '');
  if (!p || p === '/') return false;
  if (isSeoIndexablePath(p)) return false;
  return NOINDEX_PREFIXES.some((prefix) => matchesPrefix(p, prefix));
}

/** Crawlers de IA conhecidos. Recebem as mesmas fronteiras públicas do crawler padrão. */
export const AI_CRAWLER_USER_AGENTS = Object.freeze([
  'GPTBot',
  'ChatGPT-User',
  'Google-Extended',
  'anthropic-ai',
  'ClaudeBot',
  'Claude-Web',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'FacebookBot',
  'Diffbot',
  'ImagesiftBot',
  'Omgilibot',
  'Omgili',
]);

/** Lista para app/robots.js (Next metadata API). */
export function robotsDisallowPaths() {
  return [...ROBOTS_DISALLOW_PREFIXES];
}

/**
 * Páginas públicas podem ser descobertas por busca e assistentes de IA;
 * painel, APIs, autenticação e links com dados/token continuam bloqueados.
 */
export function buildRobotsRules() {
  return [
    {
      userAgent: '*',
      allow: '/',
      disallow: robotsDisallowPaths(),
    },
    ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
      userAgent,
      allow: ['/', '/llms.txt'],
      disallow: robotsDisallowPaths(),
    })),
  ];
}
