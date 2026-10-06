import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db.js';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../lib/turnstile.js';
import {
  peekEmployeePasswordSetupToken,
  completeEmployeePasswordSetup,
} from '../../../../../lib/employee-auth.js';
import {
  employee2faRequired,
  signEmployee2faChallenge,
} from '../../../../../lib/employee-2fa.js';
import { buildEmployeeLoginResponse } from '../../../../../lib/employee-login-session.js';
import { contentLocale } from '../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** GET /api/auth/employee/set-password?token= — peek masked email */
export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`employee-set-pwd-peek:${ip}`, 30, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }

    const url = new URL(request.url);
    const token = String(url.searchParams.get('token') || '').trim();
    const peek = await peekEmployeePasswordSetupToken(query, token);
    if (!peek.ok) {
      return apiError(
        request,
        peek.errorCode || ERR.INVALID_TOKEN,
        httpStatusForError(peek.errorCode || ERR.INVALID_TOKEN)
      );
    }
    return NextResponse.json({ ok: true, email: peek.maskedEmail });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET employee set-password', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/**
 * POST /api/auth/employee/set-password — complete invite.
 * Auto-login only when 2FA is not enabled; otherwise returns challenge (no cookie).
 */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`employee-set-pwd:${ip}`, 20, 15 * 60 * 1000);
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

    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const locale = contentLocale(body.locale);

    const result = await completeEmployeePasswordSetup(query, { token, password });
    if (!result.ok) {
      return apiError(
        request,
        result.errorCode || ERR.INVALID_TOKEN,
        httpStatusForError(result.errorCode || ERR.INVALID_TOKEN)
      );
    }

    const needs2fa = await employee2faRequired(result.candidateId, result.companyId);
    if (needs2fa) {
      return NextResponse.json({
        ok: true,
        requires2fa: true,
        challengeToken: await signEmployee2faChallenge({
          candidateId: result.candidateId,
          companyId: result.companyId,
        }),
      });
    }

    return await buildEmployeeLoginResponse({
      candidateId: result.candidateId,
      companyId: result.companyId,
      email: result.email,
      locale,
      fullName: result.fullName,
      sv: result.sessionVersion,
      request,
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee set-password', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
