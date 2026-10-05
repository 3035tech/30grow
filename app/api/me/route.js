import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, MAX_AGE, hashPassword, signToken, verifyPassword, sessionCookieOptions } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { LOCALE_COOKIE, normalizeLocale } from '../../../lib/i18n';
import { apiError, ERR, httpStatusForError } from '../../../lib/api-error';
import { bumpSessionVersion, verifySessionWithCapabilities } from '../../../lib/session';
import { checkRateLimit, clientIpFromRequest } from '../../../lib/rate-limit';
import { companyLicenseSummary } from '../../../lib/company-license';
import { roleMayUse2Fa } from '../../../lib/manager-2fa';
import { verifyTotpCode } from '../../../lib/totp';
import { auditFromRequest } from '../../../lib/audit';
import { enqueueTransactionalMail, isMailConfigured } from '../../../lib/mail';
import { buildManagerEmailChangedMail } from '../../../lib/user-access-mail';
import { SUPPORT_CONTACT_EMAIL } from '../../../lib/product-feedback';

async function requireSession(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!payload?.userId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  return { payload };
}

function setSessionCookies(response, payload, locale) {
  response.cookies.set(
    COOKIE_NAME,
    signToken({
      userId: payload.userId,
      role: payload.role,
      companyId: payload.companyId ?? null,
      locale,
      sv: payload.sv,
    }),
    sessionCookieOptions({ maxAge: MAX_AGE })
  );
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    secure: sessionCookieOptions().secure,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
}

/** GET /api/me — perfil do usuário logado */
export async function GET(request) {
  const { payload, error } = await requireSession(request);
  if (error) return error;

  const res = await query(
    `SELECT u.id, u.email, u.role, u.locale, u.display_name AS "displayName",
            u.company_id AS "companyId", u.last_login_at AS "lastLoginAt",
            c.name AS "companyName",
            l.license_number AS "licenseNumber", l.starts_at AS "licenseStartsAt",
            l.expires_at AS "licenseExpiresAt", l.expires_at <= now() AS "licenseExpired",
            l.offer_tier AS "licenseOfferTier", l.trial_days AS "licenseTrialDays"
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id AND c.deleted = FALSE
     LEFT JOIN company_licenses l ON l.company_id = c.id
     WHERE u.id = $1 AND u.deleted = FALSE AND u.active = TRUE
     LIMIT 1`,
    [payload.userId]
  );
  if (res.rowCount === 0) return apiError(request, ERR.USER_NOT_FOUND, 404);

  const { licenseNumber, licenseStartsAt, licenseExpiresAt, licenseExpired, ...user } = res.rows[0];
  return NextResponse.json({ user, license: companyLicenseSummary(res.rows[0]) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

/**
 * PATCH /api/me — edita displayName, locale, email (próprio) e senha (com senha atual).
 * Trocar o e-mail exige a senha atual (+ código TOTP com 2FA ativo) e avisa o endereço antigo.
 * Não altera role / company_id / active.
 */
export async function PATCH(request) {
  const { payload, error } = await requireSession(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const wantsPassword = body.newPassword != null && String(body.newPassword).length > 0;

  const current = await query(
    `SELECT id, email, role, company_id AS "companyId", password_hash AS "passwordHash", locale,
            display_name AS "displayName", totp_secret AS "totpSecret", totp_enabled_at AS "totpEnabledAt"
     FROM users WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [payload.userId]
  );
  if (current.rowCount === 0) return apiError(request, ERR.USER_NOT_FOUND, 404);
  const row = current.rows[0];

  const nextEmail = body.email !== undefined ? String(body.email || '').trim().toLowerCase() : null;
  const emailChanged = nextEmail != null && nextEmail !== String(row.email || '').trim().toLowerCase();

  if (wantsPassword || emailChanged) {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`me-password:${payload.userId}:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      });
    }
  }

  if (nextEmail != null && (!nextEmail || !nextEmail.includes('@'))) {
    return apiError(request, ERR.EMAIL_REQUIRED, httpStatusForError(ERR.EMAIL_REQUIRED));
  }

  const totpRequired = Boolean(row.totpEnabledAt && row.totpSecret && roleMayUse2Fa(row.role));
  if (emailChanged) {
    const currentPassword = String(body.currentPassword || '');
    if (!currentPassword) {
      return apiError(request, ERR.EMAIL_CHANGE_PASSWORD_REQUIRED, httpStatusForError(ERR.EMAIL_CHANGE_PASSWORD_REQUIRED));
    }
    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      return apiError(request, ERR.INVALID_CURRENT_PASSWORD, 403);
    }
    if (totpRequired) {
      const code = String(body.totpCode || '').replace(/\s+/g, '');
      if (!code) return apiError(request, ERR.TWO_FA_CODE_REQUIRED, httpStatusForError(ERR.TWO_FA_CODE_REQUIRED));
      if (!verifyTotpCode(row.totpSecret, code)) {
        return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
      }
    }
  }

  const sets = [];
  const params = [];
  let n = 1;
  let nextLocale = row.locale || 'pt-BR';

  if (body.displayName !== undefined) {
    const name = String(body.displayName || '').trim().slice(0, 120);
    sets.push(`display_name = $${n++}`);
    params.push(name || null);
  }

  if (body.locale !== undefined) {
    nextLocale = normalizeLocale(body.locale);
    sets.push(`locale = $${n++}`);
    params.push(nextLocale);
  }

  if (emailChanged) {
    const clash = await query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND deleted = FALSE AND id <> $2 LIMIT 1`,
      [nextEmail, payload.userId]
    );
    if (clash.rowCount > 0) return apiError(request, ERR.EMAIL_TAKEN, httpStatusForError(ERR.EMAIL_TAKEN));
    sets.push(`email = $${n++}`);
    params.push(nextEmail);
  }

  if (wantsPassword) {
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!currentPassword) return apiError(request, ERR.CURRENT_PASSWORD_REQUIRED, 400);
    if (newPassword.length < 8) return apiError(request, ERR.PASSWORD_TOO_SHORT, 400);
    const ok = await verifyPassword(currentPassword, row.passwordHash);
    if (!ok) return apiError(request, ERR.INVALID_CURRENT_PASSWORD, 403);
    sets.push(`password_hash = $${n++}`);
    params.push(await hashPassword(newPassword));
  }

  if (!sets.length) return apiError(request, ERR.NOTHING_TO_UPDATE, 400);

  params.push(payload.userId);
  await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${n} AND deleted = FALSE`,
    params
  );

  let nextSv = payload.sv;
  if (wantsPassword) {
    const bumped = await bumpSessionVersion(payload.userId);
    if (bumped != null) nextSv = bumped;
  }

  if (emailChanged) {
    await auditFromRequest(request, {
      actorUserId: payload.userId,
      companyId: row.companyId ?? null,
      action: 'user.email_change_self',
      targetType: 'user',
      targetId: payload.userId,
      metadata: { fields: ['email'], reauth: totpRequired ? 'password_totp' : 'password' },
    });
    if (isMailConfigured()) {
      enqueueTransactionalMail({
        to: row.email,
        ...buildManagerEmailChangedMail({
          oldEmail: row.email,
          newEmail: nextEmail,
          supportEmail: SUPPORT_CONTACT_EMAIL,
          locale: nextLocale,
          displayName: row.displayName,
        }),
      });
    }
  }

  const refreshed = await query(
    `SELECT u.id, u.email, u.role, u.locale, u.display_name AS "displayName",
            u.company_id AS "companyId", u.last_login_at AS "lastLoginAt",
            c.name AS "companyName"
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id AND c.deleted = FALSE
     WHERE u.id = $1 AND u.deleted = FALSE AND u.active = TRUE
     LIMIT 1`,
    [payload.userId]
  );
  if (refreshed.rowCount === 0) return apiError(request, ERR.USER_NOT_FOUND, 404);
  const user = refreshed.rows[0];

  const response = NextResponse.json({ ok: true, user });
  setSessionCookies(response, { ...payload, role: user.role, companyId: user.companyId, sv: nextSv }, nextLocale);
  return response;
}
