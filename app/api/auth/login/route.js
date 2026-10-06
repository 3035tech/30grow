import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { verifyPassword } from '../../../../lib/auth.js';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { verifyTurnstileToken } from '../../../../lib/turnstile.js';
import { sign2faChallenge, roleMayUse2Fa } from '../../../../lib/manager-2fa.js';
import { buildManagerLoginResponse } from '../../../../lib/manager-login-session.js';

const LOGIN_USER_SQL = `SELECT
         u.id,
         u.email,
         u.password_hash AS "passwordHash",
         u.role,
         u.locale,
         u.active,
         u.must_change_password AS "mustChangePassword",
         u.password_setup_token AS "passwordSetupToken",
         u.company_id AS "companyId",
         u.deleted AS "userDeleted",
         COALESCE(u.session_version, 1) AS "sessionVersion",
         u.totp_enabled_at AS "totpEnabledAt",
         c.deleted AS "companyDeleted"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`;

/** Antes da migration 073 — evita 500 se totp_enabled_at ainda não existir. */
const LOGIN_USER_SQL_LEGACY = `SELECT
         u.id,
         u.email,
         u.password_hash AS "passwordHash",
         u.role,
         u.locale,
         u.active,
         u.must_change_password AS "mustChangePassword",
         u.password_setup_token AS "passwordSetupToken",
         u.company_id AS "companyId",
         u.deleted AS "userDeleted",
         COALESCE(u.session_version, 1) AS "sessionVersion",
         NULL::timestamptz AS "totpEnabledAt",
         c.deleted AS "companyDeleted"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 1`;

async function loadUserForLogin(email) {
  try {
    return await query(LOGIN_USER_SQL, [email.trim()]);
  } catch (err) {
    if (err?.code === '42703') {
      return query(LOGIN_USER_SQL_LEGACY, [email.trim()]);
    }
    throw err;
  }
}

export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`login:${ip}`, 25, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const turnstile = await verifyTurnstileToken({ token: body.turnstileToken, remoteIp: ip });
    if (!turnstile.ok) {
      return apiError(request, ERR.TURNSTILE_FAILED, httpStatusForError(ERR.TURNSTILE_FAILED));
    }

    const { email, password } = body;

    if (!email || !password) {
      return apiError(request, ERR.REQUIRED_LOGIN, 400);
    }

    const res = await loadUserForLogin(email);

    const row0 = res.rows[0];
    const companyBlocked = row0?.role !== 'admin' && row0?.companyId && row0?.companyDeleted;
    if (res.rowCount === 0 || !row0?.active || row0?.userDeleted || companyBlocked) {
      await new Promise((r) => setTimeout(r, 500));
      return apiError(request, ERR.INVALID_CREDENTIALS, 401);
    }

    if (row0.passwordSetupToken) {
      // Anti-enum: mesmo código/atraso de credencial inválida.
      await new Promise((r) => setTimeout(r, 500));
      return apiError(request, ERR.INVALID_CREDENTIALS, 401);
    }

    const u = res.rows[0];
    const valid = await verifyPassword(password, u.passwordHash);
    if (!valid) {
      await new Promise((r) => setTimeout(r, 500));
      return apiError(request, ERR.INVALID_CREDENTIALS, 401);
    }

    try {
      await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [u.id]);
    } catch {
      /* best-effort */
    }

    if (u.totpEnabledAt && roleMayUse2Fa(u.role)) {
      return NextResponse.json({
        ok: true,
        requires2fa: true,
        challengeToken: await sign2faChallenge(u.id),
      });
    }

    return buildManagerLoginResponse(u);
  } catch (error) {
    console.error('Erro no login:', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
