import { localeAccessibleLabel } from '../../lib/i18n';
import { PUBLIC_MARKETING_LOCALES, publicMarketingPath, publicHreflang } from '../../lib/public-marketing-paths';

/** Plain anchors expose every translated version to crawlers and work without JavaScript. */
export function PublicLanguageLinks({ locale, page = '/', solutionIndex = null }) {
  return <nav aria-label="Languages" className="flex flex-wrap justify-center gap-x-5 gap-y-3 border-t border-line px-5 py-6 text-sm text-ink-muted">
    {PUBLIC_MARKETING_LOCALES.map((loc) => <a key={loc} href={publicMarketingPath(loc, page, solutionIndex)} hrefLang={publicHreflang(loc)} lang={loc === 'en' ? 'en-US' : loc} aria-current={loc === locale ? 'page' : undefined} className="underline-offset-4 hover:underline">{localeAccessibleLabel(loc)}</a>)}
  </nav>;
}
