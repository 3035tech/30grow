/**
 * Cloudflare Turnstile — verificação server-side (signup anti-bot).
 * Opcional: se TURNSTILE_SECRET_KEY não estiver setado, signup segue sem CAPTCHA (dev/DTOV).
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileConfigured() {
  return Boolean(String(process.env.TURNSTILE_SECRET_KEY || '').trim());
}

export function turnstileSiteKey() {
  return String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '').trim();
}

/**
 * @param {{ token?: string, remoteIp?: string|null }} params
 * @returns {Promise<{ ok: true } | { ok: false, code: string }>}
 */
export async function verifyTurnstileToken({ token, remoteIp = null }) {
  if (!isTurnstileConfigured()) return { ok: true };

  const response = String(token || '').trim();
  if (!response) return { ok: false, code: 'TURNSTILE_FAILED' };

  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', response);
  if (remoteIp && remoteIp !== 'unknown') body.set('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.success) return { ok: true };
    return { ok: false, code: 'TURNSTILE_FAILED' };
  } catch {
    return { ok: false, code: 'TURNSTILE_FAILED' };
  }
}
