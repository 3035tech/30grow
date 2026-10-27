import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getJwtSecret } from './jwt-secret.js';
import {
  MANAGER_SESSION_MAX_AGE_SEC,
  SESSION_SLIDE_WITHIN_SEC,
  shouldSlideSession,
  webSessionMaxAge,
} from './session-ttl.js';
import {
  COOKIE_NAME,
  sessionCookieOptions,
  sessionCookieSecure,
} from './session-cookie.js';

const MAX_AGE = MANAGER_SESSION_MAX_AGE_SEC;

export {
  shouldSlideSession,
  SESSION_SLIDE_WITHIN_SEC,
  COOKIE_NAME,
  MAX_AGE,
  sessionCookieOptions,
  sessionCookieSecure,
};

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

/**
 * JWT de sessão. `sv` = users.session_version (revogação sem denylist).
 * @param {{ userId: number, role: string, companyId?: number|null, locale?: string, sv: number }} claims
 */
export function signToken({ userId, role, companyId = null, locale = 'pt-BR', sv, rememberUntil }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionVersion = Number(sv);
  if (!Number.isFinite(sessionVersion) || sessionVersion < 1) {
    throw new Error('signToken requires positive sv (session_version)');
  }
  return jwt.sign(
    { userId, role, companyId, locale, sv: sessionVersion, iat: nowSec, ...(Number.isSafeInteger(rememberUntil) ? { rememberUntil } : {}) },
    getJwtSecret(),
    { expiresIn: webSessionMaxAge({ rememberUntil }, MAX_AGE, nowSec) }
  );
}

/** Verifica e decodifica o token (sem checar DB). */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}
