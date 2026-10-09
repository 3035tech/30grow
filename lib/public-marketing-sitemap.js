import { PUBLIC_MARKETING_LOCALES, SOLUTION_SLUGS, publicMarketingPath, publicLanguageAlternates } from './public-marketing-paths.js';

/** Code-owned content revision; avoid claiming every crawl changed the pages. */
export const PUBLIC_MARKETING_UPDATED_AT = '2026-10-09T00:00:00.000Z';

export function publicMarketingSitemapEntries(base) {
  if (!base) return [];
  return PUBLIC_MARKETING_LOCALES.flatMap((locale) => [
    ...['/', '/pricing'].map((page) => ({
      url: `${base}${publicMarketingPath(locale, page)}`,
      lastModified: new Date(PUBLIC_MARKETING_UPDATED_AT),
      alternates: { languages: publicLanguageAlternates(page, null, base) },
    })),
    ...SOLUTION_SLUGS.map((_, index) => ({
      url: `${base}${publicMarketingPath(locale, 'solution', index)}`,
      lastModified: new Date(PUBLIC_MARKETING_UPDATED_AT),
      alternates: { languages: publicLanguageAlternates('solution', index, base) },
    })),
  ]);
}
