export const META_PIXEL_CONSENT_KEY = '30grow.analytics-consent.v1';

const META_PIXEL_ID = '1441007351043257';
const META_PIXEL_SCRIPT = 'https://connect.facebook.net/en_US/fbevents.js';
const ALLOWED_QUERY_KEY = /^(?:utm_(?:source|medium|campaign|term|content)|fbclid)$/i;

function hasSafeMetaPixelUrl() {
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  return [...url.searchParams.keys()].every((key) => ALLOWED_QUERY_KEY.test(key));
}

export function hasMetaPixelConsent() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(META_PIXEL_CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

export function grantMetaPixelConsent() {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !hasMetaPixelConsent() ||
    !hasSafeMetaPixelUrl()
  ) {
    return false;
  }

  const f = window;
  if (!f.fbq) {
    const n = function () {
      if (n.callMethod) n.callMethod.apply(n, arguments);
      else n.queue.push(arguments);
    };
    f.fbq = n;
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    const script = document.createElement('script');
    script.async = true;
    script.src = META_PIXEL_SCRIPT;
    document.head.appendChild(script);
  }

  f.fbq('consent', 'grant');
  if (!f.__30growMetaPixelInitialized) {
    f.fbq('init', META_PIXEL_ID);
    f.__30growMetaPixelInitialized = true;
  }
  return true;
}

export function revokeMetaPixelConsent() {
  if (typeof window === 'undefined') return;
  window.fbq?.('consent', 'revoke');
}

export function trackMetaPixelEvent(eventName) {
  if (!grantMetaPixelConsent()) return false;
  window.fbq('track', eventName);
  return true;
}
