/**
 * Convite / redefinição de senha do painel: token para o usuário definir a própria senha.
 * Sem senha temporária no e-mail.
 */

import crypto from 'crypto';
import { query, withTransaction } from '../db.js';
import { enqueueTransactionalMail, isMailConfigured } from '../mail.js';
import { buildUserPasswordInviteMail } from '../user-access-mail.js';
import { ERR } from '../api-error-codes.js';
import { syncLegacyUserMembership } from './user-company-memberships.js';

/** Validade do link de definir senha. */
export const PASSWORD_SETUP_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Usuários elegíveis para receber / consumir link de senha:
 * - ativos (convite admin / reset), ou
 * - self-service signup ainda pendente (active=FALSE, signup_pending=TRUE)
 */
const ELIGIBLE_USER_SQL = `deleted = FALSE AND (active = TRUE OR signup_pending = TRUE)`;

export function generatePasswordSetupToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function passwordSetupExpiresAt(from = new Date()) {
  return new Date(from.getTime() + PASSWORD_SETUP_TTL_MS);
}

/** Hash aleatório — não há senha conhecida até o convite ser concluído. */
export async function hashUnusablePassword() {
  const { hashPassword } = await import('./auth.js');
  return hashPassword(crypto.randomBytes(32).toString('base64url'));
}

export function maskEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.indexOf('@');
  if (at < 1) return '***';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

/**
 * Emite (ou reemite) token de setup e envia e-mail.
 * @param {number} userId
 * @param {{ appUrl?: string, locale?: string, purpose?: 'invite'|'reset' }} [opts]
 * @returns {Promise<{ ok: true, emailSent: true, expiresAt: Date } | { ok: false, code: string }>}
 */
export async function issuePasswordSetupInvite(userId, { appUrl, locale = 'pt-BR', purpose = 'invite' } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, code: ERR.INVALID_USER };
  if (!isMailConfigured()) return { ok: false, code: ERR.SMTP_NOT_CONFIGURED };

  const base = String(appUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return { ok: false, code: ERR.APP_URL_NOT_CONFIGURED };

  const token = generatePasswordSetupToken();
  const expiresAt = passwordSetupExpiresAt();

  const up = await query(
    `UPDATE users
     SET password_setup_token = $2,
         password_setup_expires_at = $3,
         must_change_password = FALSE
     WHERE id = $1 AND ${ELIGIBLE_USER_SQL}
     RETURNING id, email`,
    [id, token, expiresAt.toISOString()]
  );
  if (up.rowCount === 0) return { ok: false, code: ERR.USER_NOT_FOUND };

  const email = up.rows[0].email;
  const setupUrl = `${base}/a/set-password?token=${encodeURIComponent(token)}`;
  const mail = buildUserPasswordInviteMail({
    email,
    setupUrl,
    locale,
    purpose: purpose === 'reset' ? 'reset' : 'invite',
  });
  enqueueTransactionalMail({ to: email, ...mail });

  return { ok: true, emailSent: true, expiresAt };
}

/**
 * Pedido de redefinição pela tela de login.
 * Não revela se o e-mail existe: `{ ok: true }` mesmo sem usuário.
 * Falhas de infra (SMTP / APP_URL) retornam código para a UI.
 *
 * @returns {Promise<{ ok: true, emailed: boolean } | { ok: false, code: string }>}
 */
export async function requestPasswordResetByEmail(rawEmail, { appUrl, locale = 'pt-BR' } = {}) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 254) {
    return { ok: false, code: ERR.EMAIL_REQUIRED };
  }
  if (!isMailConfigured()) return { ok: false, code: ERR.SMTP_NOT_CONFIGURED };

  const base = String(appUrl || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return { ok: false, code: ERR.APP_URL_NOT_CONFIGURED };

  const found = await query(
    `SELECT id
     FROM users
     WHERE LOWER(TRIM(email)) = $1
       AND deleted = FALSE
       AND active = TRUE
     LIMIT 1`,
    [email]
  );
  if (found.rowCount === 0) {
    return { ok: true, emailed: false };
  }

  const issued = await issuePasswordSetupInvite(found.rows[0].id, {
    appUrl: base,
    locale,
    purpose: 'reset',
  });
  if (!issued.ok) return issued;
  return { ok: true, emailed: true };
}

/**
 * @returns {Promise<{ ok: true, email: string, maskedEmail: string, userId: number } | { ok: false, code: string }>}
 */
export async function peekPasswordSetupToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token || token.length < 16) return { ok: false, code: ERR.INVALID_TOKEN };

  const r = await query(
    `SELECT id, email, password_setup_expires_at AS "expiresAt", active, deleted, signup_pending AS "signupPending"
     FROM users
     WHERE password_setup_token = $1
     LIMIT 1`,
    [token]
  );
  if (r.rowCount === 0) return { ok: false, code: ERR.INVALID_TOKEN };
  const row = r.rows[0];
  if (row.deleted) return { ok: false, code: ERR.INVALID_TOKEN };
  // Ativo OU signup self-service ainda aguardando ativação
  if (!row.active && !row.signupPending) return { ok: false, code: ERR.INVALID_TOKEN };
  if (!row.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return { ok: false, code: 'TOKEN_EXPIRED' };
  }
  return { ok: true, email: row.email, maskedEmail: maskEmail(row.email), userId: row.id };
}

/**
 * Define senha e consome o token (invalida sessões anteriores).
 * Self-service signup: também ativa a conta e limpa signup_pending.
 * @returns {Promise<{ ok: true, userId: number } | { ok: false, code: string }>}
 */
export async function completePasswordSetup(rawToken, newPassword) {
  const password = String(newPassword || '');
  if (password.length < 8) return { ok: false, code: ERR.PASSWORD_TOO_SHORT };

  const peek = await peekPasswordSetupToken(rawToken);
  if (!peek.ok) return peek;

  const { hashPassword } = await import('./auth.js');
  const passwordHash = await hashPassword(password);
  const up = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE users
       SET password_hash = $2,
           password_setup_token = NULL,
           password_setup_expires_at = NULL,
           must_change_password = FALSE,
           active = TRUE,
           signup_pending = FALSE
       WHERE id = $1
         AND password_setup_token = $3
         AND ${ELIGIBLE_USER_SQL}
       RETURNING id, company_id AS "companyId", role, active, deleted`,
      [peek.userId, passwordHash, String(rawToken || '').trim()]
    );
    const user = updated.rows[0];
    if (user) {
      await syncLegacyUserMembership(client, {
        userId: user.id,
        companyId: user.companyId,
        role: user.role,
        active: user.active,
        deleted: user.deleted,
      });
    }
    return updated;
  });
  if (up.rowCount === 0) return { ok: false, code: ERR.INVALID_TOKEN };
  const { bumpSessionVersion } = await import('./session.js');
  await bumpSessionVersion(peek.userId);
  return { ok: true, userId: peek.userId };
}
