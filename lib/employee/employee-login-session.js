import { rememberedSessionClaims, webSessionMaxAge } from '../identity/session-ttl.js';
import { EMPLOYEE_SESSION_MAX_AGE } from './employee-auth-constants.js';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  EMPLOYEE_COOKIE_NAME,
  employeeSessionCookieOptions,
  signEmployeeToken,
} from './employee-auth.js';
import { LOCALE_COOKIE, normalizeLocale } from '../i18n.js';
import { sessionCookieSecure } from '../identity/auth.js';
import { auditFromRequest, AUDIT_ACTOR_KIND } from '../audit.js';
import { loadEmployeeSessionVersion } from './employee-session-revocation.js';

/**
 * Emite cookie de sessão colaborador após login ou verificação 2FA.
 * @param {object} opts
 * @param {Request} [opts.request] — quando presente, grava auditoria
 * @param {number} [opts.sv] — session_version; se omitido, lê do banco
 * @param {string} [opts.auditAction] — ação de auditoria; default auth.login
 * @param {object} [opts.auditMetadata] — contexto adicional não sensível
 */
export async function buildEmployeeLoginResponse({
  candidateId,
  companyId,
  email,
  locale,
  fullName,
  request = null,
  sv = null,
  auditAction = 'auth.login',
  auditMetadata = {},
  rememberMe = false,
}) {
  const live = await loadEmployeeSessionVersion(candidateId, companyId);
  // Saved preference (Meu perfil) wins over the login screen picker.
  const loc = normalizeLocale(live?.preferredLocale || locale);
  let sessionVersion = Number(sv);
  if (!Number.isFinite(sessionVersion) || sessionVersion < 1) {
    sessionVersion = live?.sessionVersion || 1;
  }
  const sessionOptions = rememberedSessionClaims(rememberMe);
  const jwt = signEmployeeToken({
    ...sessionOptions,
    candidateId,
    companyId,
    email,
    locale: loc,
    sv: sessionVersion,
  });
  const jar = await cookies();
  jar.set(EMPLOYEE_COOKIE_NAME, jwt, employeeSessionCookieOptions({ maxAge: webSessionMaxAge(sessionOptions, EMPLOYEE_SESSION_MAX_AGE) }));
  jar.set(LOCALE_COOKIE, loc, {
    httpOnly: false,
    secure: sessionCookieSecure(),
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });

  if (request) {
    await auditFromRequest(request, {
      actorCandidateId: candidateId,
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      companyId,
      action: auditAction,
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { email: email || null, ...auditMetadata },
    });
  }

  return NextResponse.json({
    ok: true,
    candidateId,
    companyId,
    fullName: fullName || null,
  });
}
