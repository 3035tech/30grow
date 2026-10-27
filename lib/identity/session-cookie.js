/**
 * Cookie de sessão (gestor/colaborador) — Edge-safe (sem bcrypt/pg/jwt Node).
 */

import { MANAGER_SESSION_MAX_AGE_SEC } from './session-ttl.js';

export const COOKIE_NAME = 'team30_session';

/** Cookie Secure: HTTPS app URL ou COOKIE_SECURE=true. */
export function sessionCookieSecure() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return (
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.NODE_ENV === 'production' && appUrl.startsWith('https://'))
  );
}

/** Opções canônicas do cookie de sessão (set e clear). */
export function sessionCookieOptions({ maxAge = MANAGER_SESSION_MAX_AGE_SEC } = {}) {
  return {
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: 'lax',
    maxAge,
    path: '/',
  };
}
