import { trackLandingEvent } from '../../../../lib/analytics/landing-analytics.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';

const ALLOWED_EVENTS = new Set([
  'pageview',
  'cta_click',
  'signup_start',
  'signup_complete',
  'signup_resent',
  'login',
]);

/**
 * POST /api/analytics/landing
 * Client-side analytics tracking (público). Rate-limited + eventType allowlist.
 */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`landing-analytics:${ip}`, 120, 10 * 60 * 1000);
    if (!rl.ok) {
      return Response.json(
        { ok: false, error: 'RATE_LIMIT' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      eventType,
      sessionId = null,
      referrer = null,
      utmSource = null,
      utmMedium = null,
      utmCampaign = null,
      metadata = {},
    } = body;

    const type = String(eventType || '').trim().slice(0, 64);
    if (!type || !ALLOWED_EVENTS.has(type)) {
      return Response.json({ ok: false, error: 'eventType required' }, { status: 400 });
    }

    const userAgent = request.headers.get('user-agent') || null;
    const meta =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : {};

    await trackLandingEvent({
      eventType: type,
      sessionId: sessionId != null ? String(sessionId).slice(0, 128) : null,
      referrer: referrer != null ? String(referrer).slice(0, 2000) : null,
      utmSource: utmSource != null ? String(utmSource).slice(0, 200) : null,
      utmMedium: utmMedium != null ? String(utmMedium).slice(0, 200) : null,
      utmCampaign: utmCampaign != null ? String(utmCampaign).slice(0, 200) : null,
      userAgent,
      ipAddress: ip === 'unknown' ? null : ip,
      metadata: meta,
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[analytics] Landing track error:', err);
    // Não falhar ruidosamente — analytics não deve bloquear cliente
    return Response.json({ ok: false }, { status: 500 });
  }
}
