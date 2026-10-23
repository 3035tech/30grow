import { webSessionMaxAge } from '../../../../lib/session-ttl.js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, MAX_AGE, signToken, sessionCookieOptions } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { LOCALE_COOKIE, normalizeLocale } from '../../../../lib/i18n';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifySessionWithCapabilities } from '../../../../lib/session';

export async function PATCH(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!payload?.userId) return apiError(request, ERR.UNAUTHORIZED, 401);

  const body = await request.json().catch(() => ({}));
  const locale = normalizeLocale(body.locale);

  await query(`UPDATE users SET locale = $2 WHERE id = $1 AND deleted = FALSE`, [payload.userId, locale]);

  const response = NextResponse.json({ ok: true, locale });
  const opts = sessionCookieOptions({ maxAge: webSessionMaxAge(payload, MAX_AGE) });

  response.cookies.set(
    COOKIE_NAME,
    signToken({
      userId: payload.userId,
      role: payload.role,
      companyId: payload.companyId ?? null,
      locale,
      sv: payload.sv,
      rememberUntil: payload.rememberUntil,
    }),
    opts
  );
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: opts.secure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  return response;
}
