import { createHash, timingSafeEqual } from 'node:crypto';

function sameSecret(given, secret) {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

/** Cron routes: `Authorization: Bearer <CRON_SECRET>` or `X-Cron-Secret`. Without CRON_SECRET, always false. */
export function verifyCronRequest(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const hdr = (request.headers.get('x-cron-secret') || '').trim();
  return sameSecret(bearer, secret) || sameSecret(hdr, secret);
}
