import { rememberedSessionClaims, webSessionMaxAge } from './session-ttl.js';
import { NextResponse } from 'next/server';
import {
  COOKIE_NAME,
  MAX_AGE,
  sessionCookieOptions,
  signToken,
} from './auth.js';
import { audit, AUDIT_ACTOR_KIND } from '../audit.js';
import { normalizeLocale, LOCALE_COOKIE } from '../i18n.js';
import { setSessionVersionCache } from './session-revocation.js';

/**
 * Emite cookie de sessão gestor após login ou verificação 2FA.
 * @param {object} u — row com id, role, companyId, locale, sessionVersion, mustChangePassword, email
 */
export async function buildManagerLoginResponse(u, { rememberMe = false } = {}) {
  const sessionOptions = rememberedSessionClaims(rememberMe);
  const locale = normalizeLocale(u.locale);
  const sv = Number(u.sessionVersion) >= 1 ? Number(u.sessionVersion) : 1;
  const token = signToken({
    ...sessionOptions,
    userId: u.id,
    role: u.role,
    companyId: u.companyId ?? null,
    locale,
    sv,
  });

  const response = NextResponse.json({
    ok: true,
    mustChangePassword: Boolean(u.mustChangePassword),
  });

  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions({ maxAge: webSessionMaxAge(sessionOptions, MAX_AGE) }));
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: sessionCookieOptions().secure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  await audit({
    actorUserId: u.id,
    actorKind: AUDIT_ACTOR_KIND.MANAGER,
    companyId: u.companyId ?? null,
    action: 'auth.login',
    targetType: 'user',
    targetId: u.id,
    metadata: { email: u.email, role: u.role },
  });

  await setSessionVersionCache(u.id, sv);
  return response;
}
