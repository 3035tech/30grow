import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error';
import { unsubscribeJobAlert } from '../../../../../lib/recruiting/job-alerts';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit';

export async function GET(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`job-alert-unsub:${ip}`, 60, 10 * 60 * 1000);
  if (!rl.ok) {
    return apiError(
      request,
      ERR.RATE_LIMIT,
      429,
      {},
      { headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  const token = String(new URL(request.url).searchParams.get('token') || '').trim();
  const result = await unsubscribeJobAlert(token);
  if (!result.ok) return apiError(request, result.errorCode || ERR.INVALID_TOKEN, 400);
  return NextResponse.json({ ok: true, unsubscribed: Boolean(result.updated) });
}
