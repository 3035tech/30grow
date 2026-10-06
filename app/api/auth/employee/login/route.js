import { NextResponse } from 'next/server';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import {
  accountRateLimitKey,
  checkRateLimit,
  clientIpFromRequest,
} from '../../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../lib/turnstile.js';
import {
  completeEmployeeCompanyPick,
  loginEmployeeWithPassword,
} from '../../../../../lib/employee-auth.js';
import { query } from '../../../../../lib/db.js';
import { signEmployee2faChallenge } from '../../../../../lib/employee-2fa.js';
import { buildEmployeeLoginResponse } from '../../../../../lib/employee-login-session.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

const FAIL_DELAY_MS = 500;

async function failDelay() {
  await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
}

async function finishLogin(request, result, locale) {
  if (result.requires2fa) {
    return NextResponse.json({
      ok: true,
      requires2fa: true,
      challengeToken: await signEmployee2faChallenge({
        candidateId: result.candidateId,
        companyId: result.companyId,
      }),
    });
  }

  return buildEmployeeLoginResponse({
    candidateId: result.candidateId,
    companyId: result.companyId,
    email: result.email,
    locale,
    fullName: result.fullName,
    request,
  });
}

/** POST /api/auth/employee/login — email+password → cookie | 2FA | company pick */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`employee-login:${ip}`, 20, 15 * 60 * 1000);
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

    const locale = normalizeLocale(body.locale);
    const pickToken = String(body.pickToken || '').trim();
    const pickCandidateId = body.candidateId != null ? Number(body.candidateId) : null;

    // Step 2: choose company after password proved
    if (pickToken) {
      const picked = await completeEmployeeCompanyPick(query, {
        pickToken,
        candidateId: pickCandidateId,
      });
      if (!picked.ok) {
        await failDelay();
        return apiError(request, ERR.UNAUTHORIZED, 401);
      }
      return finishLogin(request, picked, locale);
    }

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (email) {
      const rlEmail = await checkRateLimit(
        accountRateLimitKey('employee-login', email),
        12,
        15 * 60 * 1000
      );
      if (!rlEmail.ok) {
        return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
          headers: { 'Retry-After': String(rlEmail.retryAfterSec) },
        });
      }
    }

    const result = await loginEmployeeWithPassword(query, {
      email,
      password,
      companyId: body.companyId != null ? Number(body.companyId) : null,
      companySlug: String(body.companySlug || '').trim() || null,
    });

    if (!result.ok) {
      await failDelay();
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    if (result.needsCompanyPick) {
      return NextResponse.json({
        ok: true,
        needsCompanyPick: true,
        pickToken: result.pickToken,
        companies: result.companies,
      });
    }

    return finishLogin(request, result, locale);
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee login', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
