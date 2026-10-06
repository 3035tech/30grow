import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from './db.js';
import { getJwtSecret } from './jwt-secret.js';

async function account(db, claims, lock = false) {
  const manager = claims.userId != null;
  const result = await db.query(
    manager
      ? `SELECT session_version AS sv FROM users
         WHERE id = $1 AND active = TRUE AND deleted = FALSE
         ${lock ? 'FOR UPDATE' : ''}`
      : `SELECT session_version AS sv FROM candidates
         WHERE id = $1 AND company_id = $2 AND employment_status = 'employee'
         ${lock ? 'FOR UPDATE' : ''}`,
    manager ? [claims.userId] : [claims.candidateId, claims.companyId]
  );
  return result.rows[0];
}

export async function issueSecondFactorChallenge(purpose, claims) {
  return withTransaction(async (db) => {
    const row = await account(db, claims, true);
    if (!row || !Number.isSafeInteger(Number(row.sv)) || Number(row.sv) < 1) {
      throw new Error('Invalid challenge account');
    }

    const jti = crypto.randomUUID();
    const sv = Number(row.sv);
    await db.query('DELETE FROM second_factor_challenges WHERE expires_at <= NOW()');
    await db.query(
      `INSERT INTO second_factor_challenges (
         id, purpose, user_id, candidate_id, company_id, session_version, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '5 minutes')`,
      [jti, purpose, claims.userId ?? null, claims.candidateId ?? null, claims.companyId ?? null, sv]
    );
    return { jti, sv };
  });
}

export async function secondFactorChallengeLive(claims) {
  if (!claims?.jti || !Number.isSafeInteger(Number(claims.sv)) || Number(claims.sv) < 1) {
    return false;
  }
  const row = await account({ query }, claims);
  if (!row || Number(row.sv) !== Number(claims.sv)) return false;

  const pending = await query(
    `SELECT id FROM second_factor_challenges
     WHERE id = $1 AND session_version = $2 AND expires_at > NOW()`,
    [claims.jti, claims.sv]
  );
  return pending.rowCount === 1;
}

/**
 * Consume after successful TOTP verification and return the bound session version.
 * The account lock serializes consumption with session revocation; DELETE makes
 * concurrent exchanges single-use. Session issuers must keep the returned version.
 * @returns {Promise<number|false>}
 */
export async function consumeSecondFactorChallenge(token) {
  let claims;
  try {
    claims = jwt.verify(String(token || ''), getJwtSecret(), { algorithms: ['HS256'] });
  } catch {
    return false;
  }
  if (!claims?.jti || !Number.isSafeInteger(Number(claims.sv)) || Number(claims.sv) < 1) {
    return false;
  }

  return withTransaction(async (db) => {
    const row = await account(db, claims, true);
    if (!row || Number(row.sv) !== Number(claims.sv)) return false;

    const result = await db.query(
      `DELETE FROM second_factor_challenges
       WHERE id = $1 AND session_version = $2
         AND user_id IS NOT DISTINCT FROM $3::bigint
         AND candidate_id IS NOT DISTINCT FROM $4::bigint
         AND company_id IS NOT DISTINCT FROM $5::bigint
         AND expires_at > NOW()
       RETURNING id`,
      [claims.jti, claims.sv, claims.userId ?? null, claims.candidateId ?? null, claims.companyId ?? null]
    );
    return result.rowCount === 1 ? Number(claims.sv) : false;
  });
}
