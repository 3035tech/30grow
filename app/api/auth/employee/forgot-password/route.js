import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db.js';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../lib/identity/turnstile.js';
import { requestEmployeePasswordReset } from '../../../../../lib/employee/employee-auth.js';
import { contentLocale } from '../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** POST /api/auth/employee/forgot-password — re-issue set-password email (no company list) */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`employee-forgot:${ip}`, 8, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const body = await request.json().catch(() => ({}));
    const turnstile = await verifyTurnstileToken({ token: body.turnstileToken, remoteIp: ip });
    if (!turnstile.ok) {
      return apiError(request, ERR.TURNSTILE_FAILED, httpStatusForError(ERR.TURNSTILE_FAILED));
    }

    const email = String(body.email || '').trim().toLowerCase();
    const companySlug = String(body.companySlug || '').trim() || null;
    const locale = contentLocale(body.locale);

    if (email) {
      const rlEmail = await checkRateLimit(`employee-forgot-email:${email}`, 6, 15 * 60 * 1000);
      if (!rlEmail.ok) {
        return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
          headers: { 'Retry-After': String(rlEmail.retryAfterSec) },
        });
      }
    }

    const result = await requestEmployeePasswordReset(query, {
      email,
      companySlug,
      locale,
    });

    if (!result.ok) {
      return apiError(
        request,
        result.errorCode || ERR.INTERNAL,
        httpStatusForError(result.errorCode || ERR.INTERNAL)
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee forgot-password', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
