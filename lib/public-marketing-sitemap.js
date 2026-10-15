import { OVERVIEW_SCREENSHOT, SOLUTION_SCREENSHOTS, HOME_SCREENSHOT_INDICES } from './product-screenshots.js';
import { PUBLIC_MARKETING_LOCALES, SOLUTION_SLUGS, publicMarketingPath, publicLanguageAlternates } from './public-marketing-paths.js';

/** Code-owned content revision; avoid claiming every crawl changed the pages. */
export const PUBLIC_MARKETING_UPDATED_AT = '2026-10-15T00:00:00.000Z';

export function publicMarketingSitemapEntries(base) {
  if (!base) return [];
  return PUBLIC_MARKETING_LOCALES.flatMap((locale) => [
    ...['/', '/pricing'].map((page) => ({
      url: `${base}${publicMarketingPath(locale, page)}`,
      lastModified: new Date(PUBLIC_MARKETING_UPDATED_AT),
      ...(page === '/' ? { images: [`${base}${OVERVIEW_SCREENSHOT.src}`, `${base}/brand/landing-people-context-v1.png`, ...HOME_SCREENSHOT_INDICES.map((index) => `${base}${SOLUTION_SCREENSHOTS[index].src}`)] } : {}),
      alternates: { languages: publicLanguageAlternates(page, null, base) },
    })),
    ...SOLUTION_SLUGS.map((_, index) => ({
      url: `${base}${publicMarketingPath(locale, 'solution', index)}`,
      ...(SOLUTION_SCREENSHOTS[index] ? { images: [`${base}${SOLUTION_SCREENSHOTS[index].src}`] } : {}),
      lastModified: new Date(PUBLIC_MARKETING_UPDATED_AT),
      alternates: { languages: publicLanguageAlternates('solution', index, base) },
    })),
  ]);
}
