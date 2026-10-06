/**
 * 2FA TOTP opcional — colaborador ativa/desativa em Meu perfil (/employee/profile).
 * Só exige código no login quando totp_enabled_at está preenchido.
 */
import jwt from 'jsonwebtoken';
import { checkRateLimit } from './rate-limit.js';
import { issueSecondFactorChallenge, secondFactorChallengeLive } from './second-factor-challenge.js';
import { query } from './db.js';
import { verifyPassword } from './auth.js';
import { EMPLOYMENT_STATUS } from './domain-status.js';
import { getJwtSecret } from './jwt-secret.js';
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUrl } from './totp.js';

const CHALLENGE_TTL_SEC = 5 * 60;

export async function signEmployee2faChallenge({ candidateId, companyId }) {
  const cid = Number(candidateId);
  const co = Number(companyId);
  if (!Number.isFinite(cid) || !Number.isFinite(co)) {
    throw new Error('signEmployee2faChallenge requires candidateId and companyId');
  }
  const binding = await issueSecondFactorChallenge('employee', { candidateId: cid, companyId: co });
  return jwt.sign(
    { purpose: '2fa', subject: 'employee', candidateId: cid, companyId: co, ...binding },
    getJwtSecret(),
    { expiresIn: CHALLENGE_TTL_SEC }
  );
}

/** @returns {Promise<{ candidateId: number, companyId: number } | null>} */
export async function verifyEmployee2faChallenge(token) {
  try {
    const payload = jwt.verify(String(token || ''), getJwtSecret());
    if (payload?.purpose !== '2fa' || payload?.subject !== 'employee') return null;
    const candidateId = Number(payload.candidateId);
    const companyId = Number(payload.companyId);
    if (!Number.isFinite(candidateId) || !Number.isFinite(companyId)) return null;
    if (!(await secondFactorChallengeLive(payload))) return null;
    return { candidateId, companyId };
  } catch {
    return null;
  }
}

export async function loadEmployee2faState(candidateId, companyId) {
  const r = await query(
    `SELECT c.id, c.email, c.full_name AS "fullName",
            c.totp_secret AS "totpSecret", c.totp_enabled_at AS "totpEnabledAt",
            c.employment_status AS "employmentStatus"
     FROM candidates c
     JOIN companies co ON co.id = c.company_id AND co.deleted = FALSE
     WHERE c.id = $1 AND c.company_id = $2
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  const isEmployee = row.employmentStatus === EMPLOYMENT_STATUS.EMPLOYEE;
  return {
    ...row,
    canUse2Fa: isEmployee,
    enabled: Boolean(isEmployee && row.totpEnabledAt && row.totpSecret),
  };
}

export async function beginEmployee2faSetup(candidateId, companyId) {
  const state = await loadEmployee2faState(candidateId, companyId);
  if (!state) return { ok: false, code: 'NOT_FOUND' };
  if (!state.canUse2Fa) return { ok: false, code: 'FORBIDDEN' };
  if (state.enabled) return { ok: false, code: 'ALREADY_ENABLED' };

  const secret = generateTotpSecret();
  await query(
    `UPDATE candidates SET totp_secret = $3
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    [candidateId, companyId, secret]
  );

  return {
    ok: true,
    secret,
    otpauthUrl: buildOtpAuthUrl({ secret, email: state.email, issuer: '30Grow Colaborador' }),
  };
}

export async function enableEmployee2fa(candidateId, companyId, code) {
  const state = await loadEmployee2faState(candidateId, companyId);
  if (!state?.canUse2Fa) return { ok: false, code: 'FORBIDDEN' };
  if (state.enabled) return { ok: false, code: 'ALREADY_ENABLED' };
  if (!state.totpSecret) return { ok: false, code: 'SETUP_REQUIRED' };
  if (!verifyTotpCode(state.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };

  await query(
    `UPDATE candidates SET totp_enabled_at = NOW()
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    [candidateId, companyId]
  );
  return { ok: true };
}

export async function disableEmployee2fa(candidateId, companyId, { code, password }) {
  const rate = await checkRateLimit(`employee-2fa-disable:${companyId}:${candidateId}`, 10, 15 * 60 * 1000);
  if (!rate.ok) {
    return { ok: false, code: 'RATE_LIMIT', retryAfterSec: rate.retryAfterSec };
  }
  const r = await query(
    `SELECT c.id, c.password_hash AS "passwordHash", c.totp_secret AS "totpSecret",
            c.totp_enabled_at AS "totpEnabledAt", c.employment_status AS "employmentStatus"
     FROM candidates c
     WHERE c.id = $1 AND c.company_id = $2
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (!r.rowCount) return { ok: false, code: 'NOT_FOUND' };
  const u = r.rows[0];
  if (u.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) return { ok: false, code: 'FORBIDDEN' };
  if (!u.totpEnabledAt) return { ok: false, code: 'NOT_ENABLED' };

  const validPw = await verifyPassword(String(password || ''), u.passwordHash);
  if (!validPw) return { ok: false, code: 'INVALID_CREDENTIALS' };
  if (!verifyTotpCode(u.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };

  await query(
    `UPDATE candidates SET totp_secret = NULL, totp_enabled_at = NULL
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
    [candidateId, companyId]
  );
  const { bumpEmployeeSessionVersion } = await import('./employee-session-revocation.js');
  await bumpEmployeeSessionVersion(query, candidateId, companyId);
  return { ok: true };
}

export async function verifyEmployee2faLogin(candidateId, companyId, code) {
  const state = await loadEmployee2faState(candidateId, companyId);
  if (!state?.enabled) return { ok: false, code: 'NOT_ENABLED' };
  if (!verifyTotpCode(state.totpSecret, code)) return { ok: false, code: 'TOTP_INVALID' };
  return { ok: true, person: state };
}

export async function employee2faRequired(candidateId, companyId) {
  const state = await loadEmployee2faState(candidateId, companyId);
  return Boolean(state?.enabled);
}
