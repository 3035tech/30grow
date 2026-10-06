import { consumeSecondFactorChallenge } from '../../../../../lib/second-factor-challenge.js';
import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db.js';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../../lib/turnstile.js';
import {
  verify2faChallenge,
  verify2faLogin,
} from '../../../../../lib/manager-2fa.js';
import { buildManagerLoginResponse } from '../../../../../lib/manager-login-session.js';

export const dynamic = 'force-dynamic';

/** POST /api/auth/2fa/verify — conclui login após senha + código TOTP */
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`2fa-verify:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const turnstile = await verifyTurnstileToken({ token: body.turnstileToken, remoteIp: ip });
    if (!turnstile.ok) {
      return apiError(request, ERR.TURNSTILE_FAILED, httpStatusForError(ERR.TURNSTILE_FAILED));
    }

    const userId = await verify2faChallenge(body.challengeToken);
    if (!userId) {
      return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, httpStatusForError(ERR.TWO_FA_CHALLENGE_INVALID));
    }

    const verified = await verify2faLogin(userId, body.code);
    if (!verified.ok) {
      if (verified.code === 'TOTP_INVALID') {
        return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
      }
      return apiError(request, ERR.TWO_FA_NOT_ENABLED, httpStatusForError(ERR.TWO_FA_NOT_ENABLED));
    }

    const challengeVersion = await consumeSecondFactorChallenge(body.challengeToken);
    if (!challengeVersion) return apiError(request, ERR.TWO_FA_CHALLENGE_INVALID, 401);
    const res = await query(
      `SELECT
         u.id,
         u.email,
         u.role,
         u.locale,
         u.must_change_password AS "mustChangePassword",
         u.company_id AS "companyId",
         COALESCE(u.session_version, 1) AS "sessionVersion"
       FROM users u
       WHERE u.id = $1 AND u.deleted = FALSE AND u.active = TRUE AND u.session_version = $2
       LIMIT 1`,
      [userId, challengeVersion]
    );
    if (!res.rowCount) {
      return apiError(request, ERR.INVALID_CREDENTIALS, 401);
    }

    return buildManagerLoginResponse(res.rows[0]);
  } catch (err) {
    console.error('POST 2fa verify', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
