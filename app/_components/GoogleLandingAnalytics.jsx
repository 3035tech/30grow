'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import {
  META_PIXEL_CONSENT_KEY,
  grantMetaPixelConsent,
  revokeMetaPixelConsent,
} from '../../lib/marketing/meta-pixel';
const COPY = {
  'pt-BR': { title: 'Sua privacidade', body: 'Podemos usar o Google Analytics e o Meta Pixel para medir visitas e cliques nesta página? Você pode mudar sua escolha em Cookies.', accept: 'Aceitar métricas', reject: 'Recusar métricas', settings: 'Cookies', privacy: 'Política de privacidade' },
  en: { title: 'Your privacy', body: 'May we use Google Analytics and the Meta Pixel to measure visits and clicks on this page? You can change your choice in Cookies.', accept: 'Accept metrics', reject: 'Reject metrics', settings: 'Cookies', privacy: 'Privacy policy' },
  fr: { title: 'Votre confidentialité', body: 'Pouvons-nous utiliser Google Analytics et Meta Pixel pour mesurer les visites et les clics sur cette page ? Vous pouvez modifier votre choix dans Cookies.', accept: 'Accepter les statistiques', reject: 'Refuser les statistiques', settings: 'Cookies', privacy: 'Politique de confidentialité' },
  de: { title: 'Ihre Privatsphäre', body: 'Dürfen wir Google Analytics und Meta Pixel verwenden, um Besuche und Klicks auf dieser Seite zu messen? Sie können Ihre Auswahl unter Cookies ändern.', accept: 'Statistiken akzeptieren', reject: 'Statistiken ablehnen', settings: 'Cookies', privacy: 'Datenschutzerklärung' },
};
const META_ONLY_COPY = {
  'pt-BR': { title: 'Sua privacidade', body: 'Podemos usar o Meta Pixel para medir visitas e cadastros? Você pode mudar sua escolha em Cookies.', accept: 'Aceitar métricas', reject: 'Recusar métricas', settings: 'Cookies', privacy: 'Política de privacidade' },
  en: { title: 'Your privacy', body: 'May we use the Meta Pixel to measure visits and registrations? You can change your choice in Cookies.', accept: 'Accept metrics', reject: 'Reject metrics', settings: 'Cookies', privacy: 'Privacy policy' },
  fr: { title: 'Votre confidentialité', body: 'Pouvons-nous utiliser Meta Pixel pour mesurer les visites et les inscriptions ? Vous pouvez modifier votre choix dans Cookies.', accept: 'Accepter les statistiques', reject: 'Refuser les statistiques', settings: 'Cookies', privacy: 'Politique de confidentialité' },
  de: { title: 'Ihre Privatsphäre', body: 'Dürfen wir Meta Pixel verwenden, um Besuche und Registrierungen zu messen? Sie können Ihre Auswahl unter Cookies ändern.', accept: 'Statistiken akzeptieren', reject: 'Statistiken ablehnen', settings: 'Cookies', privacy: 'Datenschutzerklärung' },
};

export default function GoogleLandingAnalytics({
  measurementId = '',
  nonce,
  locale = 'pt-BR',
  metaOnly = false,
  trackPageView = true,
}) {
  const validId = /^G-[A-Z0-9]+$/.test(measurementId);
  const [consent, setConsent] = useState(null);
  const [open, setOpen] = useState(false);
  const initialized = useRef(false);
  const metaPageViewSent = useRef(false);
  const copyCatalog = metaOnly ? META_ONLY_COPY : COPY;
  const copy = copyCatalog[locale] || copyCatalog['pt-BR'];

  useEffect(() => {
    let saved;
    try { saved = localStorage.getItem(META_PIXEL_CONSENT_KEY); } catch { /* Storage is optional. */ }
    setConsent(saved === 'granted' ? 'granted' : saved === 'denied' ? 'denied' : null);
    setOpen(saved !== 'granted' && saved !== 'denied');
  }, [validId]);

  useEffect(() => {
    if (!validId || consent !== 'granted') return;
    window[`ga-disable-${measurementId}`] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    const gtag = window.gtag;
    // Queue consent and sanitized configuration before the external script loads.
    gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    if (!initialized.current) {
      gtag('js', new Date());
      gtag('config', measurementId, { send_page_view: false, page_location: `${window.location.origin}/`, page_referrer: '', page_title: '30Grow', allow_google_signals: false, allow_ad_personalization_signals: false });
      gtag('event', 'page_view', { send_to: measurementId, page_location: `${window.location.origin}/`, page_referrer: '', page_title: '30Grow' });
      initialized.current = true;
    }
    const onClick = (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      const target = href === '/signup' ? 'signup' : href === '/pricing' ? 'pricing' : href?.startsWith('mailto:') ? 'contact' : null;
      if (target) gtag('event', 'landing_cta_click', { send_to: measurementId, cta_target: target });
    };
    document.addEventListener('click', onClick);
    return () => {
      // Next keeps loaded scripts across client navigation; disable GA on departure.
      window[`ga-disable-${measurementId}`] = true;
      document.removeEventListener('click', onClick);
    };
  }, [consent, measurementId, validId]);

  useEffect(() => {
    if (consent !== 'granted') return;

    // Keep campaign metrics on the public landing page and avoid forwarding
    // unexpected query values that could contain personal information.
    const url = new URL(window.location.href);
    const allowedQueryKey = /^(?:utm_(?:source|medium|campaign|term|content)|fbclid)$/i;
    if (![...url.searchParams.keys()].every((key) => allowedQueryKey.test(key))) return;

    if (!grantMetaPixelConsent()) return undefined;
    if (trackPageView && !metaPageViewSent.current) {
      window.fbq('track', 'PageView');
      metaPageViewSent.current = true;
    }
    return revokeMetaPixelConsent;
  }, [consent, trackPageView]);

  function choose(value) {
    if (value === 'denied') {
      initialized.current = false;
      metaPageViewSent.current = false;
      if (validId) window[`ga-disable-${measurementId}`] = true;
      window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      revokeMetaPixelConsent();
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (!/^(?:_ga(?:_|$)|_fbp$|_fbc$)/.test(name)) continue;
        const domains = window.location.hostname.split('.');
        document.cookie = `${name}=; Max-Age=0; Path=/`;
        for (let i = 0; i < domains.length - 1; i++) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domains.slice(i).join('.')}`;
      }
    }
    try { localStorage.setItem(META_PIXEL_CONSENT_KEY, value); } catch { /* Current choice still applies. */ }
    setConsent(value);
    setOpen(false);
  }

  return <>
    {consent === 'granted' && validId ? <Script id="google-landing-analytics" src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`} nonce={nonce} strategy="afterInteractive" /> : null}
    <div className="mx-auto max-w-6xl px-5 py-3 sm:px-8"><button type="button" className="min-h-touch text-xs text-ink-muted underline underline-offset-4" onClick={() => setOpen(true)}>{copy.settings}</button></div>
    {open ? <aside aria-label={copy.title} className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-card border border-ink/10 bg-surface p-5 shadow-card sm:inset-x-6">
      <p className="m-0 font-semibold text-ink">{copy.title}</p>
      <p className="mb-3 mt-2 text-sm leading-6 text-ink-muted">{copy.body} <a href="/privacy" className="text-brand-700 underline">{copy.privacy}</a></p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => choose('denied')} className="min-h-touch rounded-control border border-ink/20 px-4 py-2 text-sm font-semibold text-ink">{copy.reject}</button>
        <button type="button" onClick={() => choose('granted')} className="min-h-touch rounded-control bg-brand-700 px-4 py-2 text-sm font-semibold text-white">{copy.accept}</button>
      </div>
    </aside> : null}
  </>;
}
