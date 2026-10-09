import { normalizeLocale } from './locale-negotiation.js';

/** Stable, crawlable marketing URLs. App/authentication paths are never localized. */
export const PUBLIC_LOCALE_PREFIXES = Object.freeze({
  'pt-BR': '', 'pt-PT': '/pt-pt', en: '/en', 'es-419': '/es',
  'es-ES': '/es-es', 'fr-FR': '/fr', 'de-DE': '/de',
});
export const PUBLIC_MARKETING_LOCALES = Object.freeze(Object.keys(PUBLIC_LOCALE_PREFIXES));
export const PUBLIC_LOCALE_HEADER = 'x-public-locale';

export const SOLUTION_SLUGS = Object.freeze([
  ['recrutamento-e-selecao', 'recruiting', 'reclutamiento', 'recrutement', 'recruiting'],
  ['eneagrama-e-motivadores', 'enneagram-and-motivators', 'eneagrama-y-motivadores', 'enneagramme-et-motivateurs', 'enneagramm-und-motivatoren'],
  ['desempenho-e-clima', 'performance-and-engagement', 'desempeno-y-clima', 'performance-et-climat', 'performance-und-teamklima'],
  ['onboarding-e-lms', 'onboarding-and-lms', 'onboarding-y-lms', 'integration-et-lms', 'onboarding-und-lms'],
  ['departamento-pessoal', 'hr-operations', 'operaciones-de-rrhh', 'operations-rh', 'hr-prozesse'],
  ['organograma-e-gestao', 'organization-and-management', 'organizacion-y-gestion', 'organisation-et-management', 'organisation-und-management'],
].map((slugs) => Object.freeze(slugs)));

function languageIndex(locale) {
  const loc = normalizeLocale(locale);
  return loc.startsWith('pt') ? 0 : loc.startsWith('es') ? 2 : loc === 'fr-FR' ? 3 : loc === 'de-DE' ? 4 : 1;
}

export function publicMarketingPath(locale, page = '/', solutionIndex = null) {
  const loc = normalizeLocale(locale);
  const prefix = PUBLIC_LOCALE_PREFIXES[loc];
  if (page === 'solution' && SOLUTION_SLUGS[solutionIndex]) {
    return `${prefix}/${loc.startsWith('pt') ? 'solucoes' : 'solutions'}/${SOLUTION_SLUGS[solutionIndex][languageIndex(loc)]}`;
  }
  if (page === '/pricing') return `${prefix}/pricing`;
  return prefix || '/';
}

/** Only existing public marketing URLs match; /en/dashboard and /en/api are excluded. */
export function publicMarketingRoute(pathname) {
  const path = String(pathname || '/').replace(/\/$/, '') || '/';
  for (const locale of PUBLIC_MARKETING_LOCALES) {
    if (path === publicMarketingPath(locale)) return { locale, page: '/' };
    if (path === publicMarketingPath(locale, '/pricing')) return { locale, page: '/pricing' };
    for (let index = 0; index < SOLUTION_SLUGS.length; index += 1) {
      if (path === publicMarketingPath(locale, 'solution', index)) {
        return { locale, page: 'solution', solutionIndex: index };
      }
    }
  }
  return null;
}

// Google hreflang only accepts ISO language codes and optional two-letter regions.
export function publicHreflang(locale) {
  return normalizeLocale(locale) === 'es-419' ? 'es' : normalizeLocale(locale);
}

export function publicLanguageAlternates(page = '/', solutionIndex = null, base = '') {
  return {
    ...Object.fromEntries(PUBLIC_MARKETING_LOCALES.map((locale) => [publicHreflang(locale), `${base}${publicMarketingPath(locale, page, solutionIndex)}`])),
    'x-default': `${base}${publicMarketingPath('pt-BR', page, solutionIndex)}`,
  };
}
