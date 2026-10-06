import { consumeSecondFactorChallenge } from '../../../../../../lib/second-factor-challenge.js';
import { apiError, ERR, httpStatusForError } from '../../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../../lib/turnstile.js';
import {
  verifyEmployee2faChallenge,
  verifyEmployee2faLogin,
} from '../../../../../../lib/employee-2fa.js';
import { buildEmployeeLoginResponse } from '../../../../../../lib/employee-login-session.js';
import { normalizeLocale } from '../../../../../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** POST /api/auth/employee/2fa/verify — conclui login colaborador após senha + código TOTP (só se 2FA ativo) */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`employee-2fa-verify:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const turnstile = await verifyTurnstileToken({ token: body.turnstileToken, remoteIp: ip });
    if (!turnstile.ok) {
      return apiError(request, ERR.TURNSTILE_FAILED, httpStatusForError(ERR.TURNSTILE_FAILED));
    }

    const locale = normalizeLocale(body.locale);
    const challenge = await verifyEmployee2faChallenge(body.challengeToken);
    if (!challenge) {
      return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, httpStatusForError(ERR.TWO_FA_CHALLENGE_INVALID));
    }

    const verified = await verifyEmployee2faLogin(challenge.candidateId, challenge.companyId, body.code);
    if (!verified.ok) {
      if (verified.code === 'TOTP_INVALID') {
        return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
      }
      return apiError(request, ERR.TWO_FA_NOT_ENABLED, httpStatusForError(ERR.TWO_FA_NOT_ENABLED));
    }

    const challengeVersion = await consumeSecondFactorChallenge(body.challengeToken);
    if (!challengeVersion) return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, 401);
    return await buildEmployeeLoginResponse({
      sv: challengeVersion,
      candidateId: challenge.candidateId,
      companyId: challenge.companyId,
      email: verified.person.email,
      locale,
      fullName: verified.person.fullName,
      request,
    });
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST employee 2fa verify', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
