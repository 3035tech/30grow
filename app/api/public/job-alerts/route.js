import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';
import { upsertJobAlert } from '../../../../lib/recruiting/job-alerts';

export async function POST(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`job-alert:${ip}`, 10, 60 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const contentType = request.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await request.json().catch(() => ({}))
    : Object.fromEntries(await request.formData().catch(() => new FormData()));
  const result = await upsertJobAlert({
    email: body.email,
    name: body.name,
    filters: body.filters,
  });
  if (!result.ok) return apiError(request, result.errorCode || 'INVALID_DATA', 400);

  // Copy genérica — não confirma se o e-mail existe na lista (anti-enumeração).
  return NextResponse.json({ ok: true });
}
