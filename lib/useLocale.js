'use client';

import { useCallback, useEffect, useState } from 'react';
import { LOCALE_COOKIE, localeHtmlLang, normalizeLocale } from './i18n.js';
import { loadCatalog } from './i18n-client.js';
import { publicMarketingRoute } from './public-marketing-paths.js';

function readCookieLocale() {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${LOCALE_COOKIE}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

/**
 * @param {string} initialLocale
 * @param {{ fromAccount?: boolean }} [opts] `fromAccount`: signed-in areas, where the locale saved on
 *   the account wins over the cookie (which the landing page selector also writes).
 */
export function useLocale(initialLocale = 'pt-BR', { fromAccount = false } = {}) {
  const [locale, setLocaleState] = useState(() => normalizeLocale(initialLocale));

  /** Switches only after the new catalog is in the browser, so text never shows raw keys. */
  const setLocale = useCallback((next) => {
    const target = normalizeLocale(next);
    loadCatalog(target)
      .then(() => setLocaleState(target))
      .catch(() => setLocaleState(target));
  }, []);

  useEffect(() => {
    // Marketing URLs own their language; a stored app locale must not change their content.
    if (publicMarketingRoute(window.location.pathname) || window.location.pathname === '/blog' || window.location.pathname.startsWith('/blog/')) {
      setLocale(initialLocale);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('lang');
    const next = normalizeLocale(
      fromQuery || (fromAccount ? initialLocale : readCookieLocale() || initialLocale)
    );
    setLocale(next);
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
  }, [initialLocale, fromAccount, setLocale]);

  useEffect(() => {
    document.documentElement.lang = localeHtmlLang(locale);
  }, [locale]);

  return [locale, setLocale];
}
