import { buildRobotsRules } from '../lib/crawler-guard.js';
import { publicSiteBaseUrl } from '../lib/public-site-url.js';

/**
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
 *
 * /jobs e /companies ficam de fora do Disallow — vagas públicas continuam indexáveis.
 * Busca e assistentes de IA descobrem superfícies públicas; áreas privadas ficam bloqueadas.
 */
export default function robots() {
  const base = publicSiteBaseUrl();
  return {
    rules: buildRobotsRules(),
    sitemap: base ? `${base}/sitemap.xml` : '/sitemap.xml',
    host: base || undefined,
  };
}
