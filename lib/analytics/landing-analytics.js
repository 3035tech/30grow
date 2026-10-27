/**
 * Landing page analytics tracking.
 * Eventos: pageview, cta_click, signup_start, signup_complete, login.
 */

import crypto from 'crypto';
import { query } from '../db.js';

/**
 * @param {{
 *   eventType: string,
 *   sessionId?: string|null,
 *   referrer?: string|null,
 *   utmSource?: string|null,
 *   utmMedium?: string|null,
 *   utmCampaign?: string|null,
 *   userAgent?: string|null,
 *   ipAddress?: string|null,
 *   metadata?: object
 * }} params
 */
export async function trackLandingEvent({
  eventType,
  sessionId = null,
  referrer = null,
  utmSource = null,
  utmMedium = null,
  utmCampaign = null,
  userAgent = null,
  ipAddress = null,
  metadata = {},
}) {
  try {
    const ipHash = ipAddress
      ? crypto.createHash('sha256').update(String(ipAddress)).digest('hex')
      : null;

    await query(
      `INSERT INTO landing_analytics (
        event_type, session_id, referrer,
        utm_source, utm_medium, utm_campaign,
        user_agent, ip_hash, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        eventType,
        sessionId,
        referrer,
        utmSource,
        utmMedium,
        utmCampaign,
        userAgent,
        ipHash,
        JSON.stringify(metadata),
      ]
    );
  } catch (err) {
    console.error('[landing-analytics] Track error:', err);
    // Não falhar a request principal
  }
}

/**
 * Extrai UTM params de URLSearchParams.
 */
export function extractUtmParams(searchParams) {
  return {
    utmSource: searchParams.get('utm_source') || null,
    utmMedium: searchParams.get('utm_medium') || null,
    utmCampaign: searchParams.get('utm_campaign') || null,
  };
}
