import BUNDLED_CATALOGS from './i18n/bundled-catalogs.js';
import { REGIONAL_MESSAGES } from './i18n/regional.js';
import { DEFAULT_LOCALE, normalizeLocale } from './locale-negotiation.js';

/**
 * UI locales. `en` remains the internal compatibility key used by older
 * sessions and APIs; it is presented as English (US) in the UI.
 */
export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  normalizeLocale,
  contentLocale,
} from './locale-negotiation.js';


export function localeLabel(locale) {
  switch (normalizeLocale(locale)) {
    case 'en': return 'English';
    case 'es-419': return 'Español (Latinoamérica)';
    case 'es-ES': return 'Español (España)';
    case 'fr-FR': return 'Français';
    case 'de-DE': return 'Deutsch';
    default: return 'Português';
  }
}

export function localeAccessibleLabel(locale) {
  switch (normalizeLocale(locale)) {
    case 'pt-PT': return 'Português, Portugal';
    case 'en': return 'English, United States';
    case 'es-419': return 'Español, Latinoamérica';
    case 'es-ES': return 'Español, España';
    case 'fr-FR': return 'Français, France';
    case 'de-DE': return 'Deutsch, Deutschland';
    default: return 'Português, Brasil';
  }
}

/** Short language code for compact pickers; the flag tells regional variants apart (🇧🇷 PT / 🇵🇹 PT). */
export function localeShortCode(locale) {
  return normalizeLocale(locale).slice(0, 2).toUpperCase();
}

/** Visual marker for the language picker. Latin America is represented by a globe. */
export function localeFlag(locale) {
  switch (normalizeLocale(locale)) {
    case 'pt-PT': return '🇵🇹';
    case 'en': return '🇺🇸';
    case 'es-419': return '🌎';
    case 'es-ES': return '🇪🇸';
    case 'fr-FR': return '🇫🇷';
    case 'de-DE': return '🇩🇪';
    default: return '🇧🇷';
  }
}

export function localeHtmlLang(locale) {
  switch (normalizeLocale(locale)) {
    case 'pt-PT': return 'pt-PT';
    case 'en': return 'en-US';
    case 'es-419': return 'es-419';
    case 'es-ES': return 'es-ES';
    case 'fr-FR': return 'fr-FR';
    case 'de-DE': return 'de-DE';
    default: return 'pt-BR';
  }
}

/** Region defaults are intentionally separate from language selection. */
export const LOCALE_REGION_CONFIG = Object.freeze({
  'pt-BR': Object.freeze({ language: 'pt', region: 'BR', currency: 'BRL', timezone: 'America/Sao_Paulo' }),
  'pt-PT': Object.freeze({ language: 'pt', region: 'PT', currency: 'EUR', timezone: 'Europe/Lisbon' }),
  en: Object.freeze({ language: 'en', region: 'US', currency: 'USD', timezone: 'America/New_York' }),
  'es-ES': Object.freeze({ language: 'es', region: 'ES', currency: 'EUR', timezone: 'Europe/Madrid' }),
  'es-419': Object.freeze({ language: 'es', region: '419', currency: 'USD', timezone: 'America/Mexico_City' }),
  'fr-FR': Object.freeze({ language: 'fr', region: 'FR', currency: 'EUR', timezone: 'Europe/Paris' }),
  'de-DE': Object.freeze({ language: 'de', region: 'DE', currency: 'EUR', timezone: 'Europe/Berlin' }),
});

export function localeRegionConfig(locale) {
  return LOCALE_REGION_CONFIG[normalizeLocale(locale)] || LOCALE_REGION_CONFIG[DEFAULT_LOCALE];
}

export function localeNumberLocale(locale) {
  return localeHtmlLang(locale);
}

export function localeCurrency(locale) {
  return localeRegionConfig(locale).currency;
}

/** Full catalog keys; every other UI locale is a regional overlay on one of these. */
export const FULL_CATALOG_LOCALES = Object.freeze(['pt-BR', 'en', 'fr-FR', 'de-DE']);

/** Loaded full catalogs. Server: all of them. Browser: filled by `registerCatalog`. */
export const messages = { ...BUNDLED_CATALOGS };

export function registerCatalog(key, catalog) {
  if (!catalog || messages[key] === catalog) return;
  messages[key] = catalog;
  catalogListCache.clear();
  messageNodeCache.clear();
}

/** Full catalog a locale needs (catalogs share the same keys, so one is enough). */
export function catalogKeyForLocale(locale) {
  return localeFallbackChain(locale).find((key) => FULL_CATALOG_LOCALES.includes(key)) || DEFAULT_LOCALE;
}

/** Open Graph locale tag (`pt_BR`, `en_US`, `fr_FR`...). */
export function localeOpenGraph(locale) {
  return localeHtmlLang(locale).replace('-', '_');
}

function readMessage(catalog, parts) {
  let node = catalog;
  for (const part of parts) node = node?.[part];
  return node;
}

/**
 * Ordered locale keys to try for one UI locale: itself, its language sibling,
 * then the closest full catalog (Portuguese family -> pt-BR, others -> en),
 * then the other full catalog so a key missing in one base never shows a path.
 */
export function localeFallbackChain(locale) {
  const loc = normalizeLocale(locale);
  const chain = [loc];
  if (loc === 'es-ES') chain.push('es-419');
  const [primary, secondary] = loc.startsWith('pt-') ? ['pt-BR', 'en'] : ['en', 'pt-BR'];
  for (const key of [primary, secondary]) if (!chain.includes(key)) chain.push(key);
  return chain;
}

const catalogListCache = new Map();

function localeCatalogs(locale) {
  const loc = normalizeLocale(locale);
  const cached = catalogListCache.get(loc);
  if (cached) return cached;
  const out = [];
  for (const key of localeFallbackChain(loc)) {
    if (REGIONAL_MESSAGES[key]) out.push(REGIONAL_MESSAGES[key]);
    if (messages[key]) out.push(messages[key]);
  }
  // Browser before a locale switch finishes loading: any loaded catalog beats raw key paths.
  for (const key of FULL_CATALOG_LOCALES) if (messages[key] && !out.includes(messages[key])) out.push(messages[key]);
  catalogListCache.set(loc, out);
  return out;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function mergeUnder(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = mergeUnder(base[key], value);
  return out;
}

const messageNodeCache = new Map();

/**
 * Catalog subtree (e.g. `panel.help`) with the fallback chain deep-merged, so
 * callers that read many keys off one object still get per-key fallback.
 */
export function messageNode(locale, path) {
  const cacheKey = `${normalizeLocale(locale)}|${path}`;
  if (messageNodeCache.has(cacheKey)) return messageNodeCache.get(cacheKey);
  const parts = String(path || '').split('.');
  let node;
  for (const catalog of [...localeCatalogs(locale)].reverse()) node = mergeUnder(node, readMessage(catalog, parts));
  const result = node ?? {};
  messageNodeCache.set(cacheKey, result);
  return result;
}

/**
 * Picks the stored text for DB/content fields kept per language
 * (`{ pt, en }` or `{ 'pt-BR', en, fr-FR, ... }`), following the fallback chain.
 */
export function localizedField(locale, variants = {}) {
  for (const key of localeFallbackChain(locale)) {
    const short = key.split('-')[0];
    const value = variants[key] ?? variants[short];
    if (value != null && value !== '') return value;
  }
  return '';
}

export function interpolate(template, values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    const val = values[key];
    return val == null ? '' : String(val);
  });
}

export function t(locale, path, values = {}) {
  const parts = String(path || '').split('.');
  let node;
  for (const catalog of localeCatalogs(locale)) {
    node = readMessage(catalog, parts);
    if (node != null) break;
  }
  return interpolate(node ?? path, values);
}

/** Count-aware copy: `${path}One` when count is 1 and that key exists, else `path` (plural). `{n}` = count. */
export function tCount(locale, path, count, values = {}) {
  const vars = { n: count, ...values };
  if (Number(count) === 1) {
    const oneKey = `${path}One`;
    const one = t(locale, oneKey, vars);
    if (one !== oneKey) return one;
  }
  return t(locale, path, vars);
}

export function errorMessage(locale, code, fallback = '') {
  return t(locale, `errors.${code}`) || fallback || t(locale, 'errors.INTERNAL');
}
