import { webSessionMaxAge } from '../../../../lib/session-ttl.js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  COOKIE_NAME,
  MAX_AGE,
  hashPassword,
  verifyPassword,
  signToken,
  sessionCookieOptions,
} from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { audit } from '../../../../lib/audit';
import { bumpSessionVersion, verifySessionWithCapabilities } from '../../../../lib/session';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';

export async function POST(request) {
  const token = await (await cookies()).get(COOKIE_NAME)?.value;
  const session = await verifySessionWithCapabilities(token);
  if (!session?.userId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`change-password:${session.userId}:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword) return apiError(request, ERR.CURRENT_PASSWORD_REQUIRED, 400);
  if (newPassword.length < 8) return apiError(request, ERR.PASSWORD_TOO_SHORT, 400);

  const result = await query(
    `SELECT password_hash AS "passwordHash"
     FROM users
     WHERE id = $1 AND active = TRUE AND deleted = FALSE
     LIMIT 1`,
    [session.userId]
  );
  if (result.rowCount === 0) return apiError(request, ERR.UNAUTHORIZED, 401);

  const valid = await verifyPassword(currentPassword, result.rows[0].passwordHash);
  if (!valid) return apiError(request, ERR.INVALID_CURRENT_PASSWORD, 400);

  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE
     WHERE id = $2 AND deleted = FALSE`,
    [passwordHash, session.userId]
  );

  const newSv = await bumpSessionVersion(session.userId);
  const sv = newSv != null ? newSv : session.sv;

  await audit({
    actorUserId: session.userId,
    action: 'auth.password_change',
    targetType: 'user',
    targetId: session.userId,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    COOKIE_NAME,
    signToken({
      userId: session.userId,
      role: session.role,
      companyId: session.companyId ?? null,
      locale: session.locale || 'pt-BR',
      sv,
      rememberUntil: session.rememberUntil,
    }),
    sessionCookieOptions({ maxAge: webSessionMaxAge(session, MAX_AGE) })
  );
  return response;
}
