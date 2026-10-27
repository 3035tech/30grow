/**
 * Resolve public company assessment link by token (shared by API + RSC pages).
 */

import crypto from 'node:crypto';
import { queryRead, withTransaction } from './db.js';
import { ERR } from './api-error-codes.js';

/**
 * @returns {{ ok: true, company: object } | { ok: false, errorCode: string }}
 */
export async function resolveCompanyLinkByToken(token) {
  const tokenValue = String(token || '').trim();
  if (!tokenValue) return { ok: false, errorCode: ERR.INVALID_TOKEN };

  const r = await queryRead(
    `SELECT
       c.id AS "companyId",
       c.name,
       l.expires_at AS "expiresAt",
       COALESCE(l.require_candidate_email, FALSE) AS "requireCandidateEmail"
     FROM company_links l
     JOIN companies c ON c.id = l.company_id
     WHERE l.token = $1 AND l.active = TRUE AND l.expires_at > NOW()
       AND c.deleted = FALSE
     LIMIT 1`,
    [tokenValue]
  );
  if (r.rowCount === 0) return { ok: false, errorCode: ERR.EXPIRED_LINK };
  return { ok: true, company: r.rows[0] };
}

/** Reuse the current team link, or rotate an expired one under the company row lock. */
export async function ensureActiveCompanyLink(companyId) {
  return withTransaction(async (db) => {
    const company = await db.query(
      'SELECT id FROM companies WHERE id = $1 AND deleted = FALSE FOR UPDATE',
      [companyId]
    );
    if (!company.rowCount) return null;
    await db.query(
      `UPDATE company_links SET active = FALSE, rotated_at = NOW()
       WHERE company_id = $1 AND active = TRUE AND expires_at <= NOW()`,
      [companyId]
    );
    const existing = await db.query(
      `SELECT token FROM company_links
       WHERE company_id = $1 AND active = TRUE AND expires_at > NOW() LIMIT 1`,
      [companyId]
    );
    if (existing.rowCount) return existing.rows[0].token;
    const token = crypto.randomBytes(24).toString('hex');
    await db.query(
      `INSERT INTO company_links (company_id, token, active, expires_at, require_candidate_email)
       VALUES ($1, $2, TRUE, NOW() + INTERVAL '7 days', TRUE)`,
      [companyId, token]
    );
    return token;
  });
}
