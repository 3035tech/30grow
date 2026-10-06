import { buildProductLlmsTxt, productLandingAbsoluteUrl } from '../../lib/product-landing-seo';
import { listBlogPosts } from '../../lib/blog/index.js';

function blogSection() {
  const lines = ['## Blog articles (pt-BR)'];
  for (const post of listBlogPosts()) {
    lines.push(`- [${post.title}](${productLandingAbsoluteUrl(post.path)}): ${post.description}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Documento plano para crawlers de IA (padrão llms.txt).
 * @see https://llmstxt.org/
 */
export function GET() {
  const body = `${buildProductLlmsTxt()}\n${blogSection()}`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Robots-Tag': 'all',
    },
  });
}
