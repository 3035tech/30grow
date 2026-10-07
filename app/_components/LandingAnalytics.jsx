'use client';

import { useEffect } from 'react';
import GoogleLandingAnalytics from './GoogleLandingAnalytics';

/**
 * Client-side analytics para landpage.
 * Rastreia pageview e gera sessionId para funil de conversão.
 */
export default function LandingAnalytics(props) {
  useEffect(() => {
    // Gera ou recupera sessionId
    let sessionId = null;
    if (typeof sessionStorage !== 'undefined') {
      sessionId = sessionStorage.getItem('landing_session_id');
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        sessionStorage.setItem('landing_session_id', sessionId);
      }
    }

    // Captura UTM params da URL
    const url = new URL(window.location.href);
    const utmSource = url.searchParams.get('utm_source');
    const utmMedium = url.searchParams.get('utm_medium');
    const utmCampaign = url.searchParams.get('utm_campaign');

    // Track pageview
    fetch('/api/analytics/landing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'pageview',
        sessionId,
        referrer: document.referrer ? new URL(document.referrer).origin : null,
        utmSource,
        utmMedium,
        utmCampaign,
        metadata: {
          path: window.location.pathname,
        },
      }),
    }).catch(() => {
      // Não falhar silenciosamente, analytics não deve bloquear
    });
  }, []);

  return <GoogleLandingAnalytics {...props} />;
}
