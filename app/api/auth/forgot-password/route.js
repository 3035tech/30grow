import { runtimeAppUrl } from '../../../../lib/app-url.js';
import { NextResponse } from 'next/server';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';
import { requestPasswordResetByEmail } from '../../../../lib/user-password-invite';
import { audit } from '../../../../lib/audit';
import { normalizeLocale } from '../../../../lib/i18n';
import { verifyTurnstileToken } from '../../../../lib/turnstile.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/forgot-password — body: { email, locale? }
 * Resposta genérica (não revela se o e-mail existe), salvo falha de SMTP / rate limit.
 */
export async function POST(request) {
  const ip = clientIpFromRequest(request);
  const rlIp = await checkRateLimit(`forgot-password-ip:${ip}`, 10, 15 * 60 * 1000);
  if (!rlIp.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rlIp.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));

  const turnstile = await verifyTurnstileToken({ token: body.turnstileToken, remoteIp: ip });
  if (!turnstile.ok) {
    return apiError(request, ERR.TURNSTILE_FAILED, httpStatusForError(ERR.TURNSTILE_FAILED));
  }

  const email = String(body.email || '').trim().toLowerCase();
  const locale = normalizeLocale(body.locale || 'pt-BR');

  const rlEmail = await checkRateLimit(`forgot-password-email:${email || 'empty'}`, 5, 60 * 60 * 1000);
  if (!rlEmail.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rlEmail.retryAfterSec) } });
  }

  const appUrl = String(runtimeAppUrl() || new URL(request.url).origin).replace(
    /\/+$/,
    ''
  );

  const result = await requestPasswordResetByEmail(email, { appUrl, locale });
  if (!result.ok) {
    if (result.code === 'EMAIL_REQUIRED') return apiError(request, ERR.EMAIL_REQUIRED, 400);
    if (result.code === 'SMTP_NOT_CONFIGURED') return apiError(request, ERR.SMTP_NOT_CONFIGURED, 503);
    if (result.code === 'APP_URL_REQUIRED') return apiError(request, ERR.INTERNAL, 500);
    return apiError(request, result.code || 'INTERNAL', 400);
  }

  await audit({
    actorUserId: null,
    action: 'auth.password_reset_request',
    targetType: 'user',
    targetId: null,
    metadata: { emailed: Boolean(result.emailed), hasEmail: Boolean(email) },
  });

  return NextResponse.json({ ok: true });
}
