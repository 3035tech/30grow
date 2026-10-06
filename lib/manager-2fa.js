/**
 * 2FA TOTP opcional — o gestor ativa/desativa no perfil (Meu perfil).
 * Só exige código no login quando totp_enabled_at está preenchido.
 */
import jwt from 'jsonwebtoken';
import { checkRateLimit } from './rate-limit.js';
import { issueSecondFactorChallenge, secondFactorChallengeLive } from './second-factor-challenge.js';
import { query } from './db.js';
import { verifyPassword } from './auth.js';
import { isManagerRole } from './permissions.js';
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUrl } from './totp.js';

const CHALLENGE_TTL_SEC = 5 * 60;

export function roleMayUse2Fa(role) {
  return isManagerRole({ role });
}

function jwtSecret() {
  const s = String(process.env.JWT_SECRET || '').trim();
  if (!s || s.length < 32) throw new Error('JWT_SECRET missing');
  return s;
}

export async function sign2faChallenge(userId) {
  const binding = await issueSecondFactorChallenge('manager', { userId: Number(userId) });
  return jwt.sign(
    { purpose: '2fa', subject: 'manager', userId: Number(userId), ...binding },
    jwtSecret(),
    { expiresIn: CHALLENGE_TTL_SEC }
  );
}

export async function verify2faChallenge(token) {
  try {
    const payload = jwt.verify(String(token || ''), jwtSecret());
    if (payload?.purpose !== '2fa') return null;
    if (payload?.subject && payload.subject !== 'manager') return null;
    if (!payload?.userId) return null;
    if (!(await secondFactorChallengeLive(payload))) return null;
    return Number(payload.userId);
  } catch {
    return null;
  }
}

export async function loadUser2faState(userId) {
  const r = await query(
    `SELECT id, email, role, totp_secret AS "totpSecret", totp_enabled_at AS "totpEnabledAt"
     FROM users WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [userId]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    ...row,
    canUse2Fa: roleMayUse2Fa(row.role),
    enabled: Boolean(row.totpEnabledAt && row.totpSecret),
  };
}

export async function begin2faSetup(userId) {
  const state = await loadUser2faState(userId);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  if (!state.canUse2Fa) return { ok: false, code: 'FORBIDDEN' };
  if (state.enabled) return { ok: false, code: 'ALREADY_ENABLED' };

  const secret = generateTotpSecret();
  await query(`UPDATE users SET totp_secret = $2 WHERE id = $1`, [userId, secret]);

  return {
    ok: true,
    secret,
    otpauthUrl: buildOtpAuthUrl({ secret, email: state.email }),
  };
}

export async function enable2fa(userId, code) {
  const state = await loadUser2faState(userId);
  if (!state?.canUse2Fa) return { ok: false, code: 'FORBIDDEN' };
  if (state.enabled) return { ok: false, code: 'ALREADY_ENABLED' };
  if (!state.totpSecret) return { ok: false, code: 'SETUP_REQUIRED' };
  if (!verifyTotpCode(state.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };

  await query(`UPDATE users SET totp_enabled_at = NOW() WHERE id = $1`, [userId]);
  return { ok: true };
}

export async function disable2fa(userId, { code, password }) {
  const rate = await checkRateLimit(`manager-2fa-disable:${userId}`, 10, 15 * 60 * 1000);
  if (!rate.ok) {
    return { ok: false, code: 'RATE_LIMIT', retryAfterSec: rate.retryAfterSec };
  }
  const r = await query(
    `SELECT id, role, password_hash AS "passwordHash", totp_secret AS "totpSecret",
            totp_enabled_at AS "totpEnabledAt"
     FROM users WHERE id = $1 AND deleted = FALSE LIMIT 1`,
    [userId]
  );
  if (!r.rowCount) return { ok: false, code: 'NOT_FOUND' };
  const u = r.rows[0];
  if (!roleMayUse2Fa(u.role)) return { ok: false, code: 'FORBIDDEN' };
  if (!u.totpEnabledAt) return { ok: false, code: 'NOT_ENABLED' };

  const validPw = await verifyPassword(String(password || ''), u.passwordHash);
  if (!validPw) return { ok: false, code: 'INVALID_CREDENTIALS' };
  if (!verifyTotpCode(u.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };

  await query(
    `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = $1`,
    [userId]
  );
  return { ok: true };
}

export async function verify2faLogin(userId, code) {
  const state = await loadUser2faState(userId);
  if (!state?.enabled) return { ok: false, code: 'NOT_ENABLED' };
  if (!verifyTotpCode(state.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };
  return { ok: true, user: state };
}
