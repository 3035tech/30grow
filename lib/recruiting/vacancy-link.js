import crypto from 'node:crypto';
import { query } from '../db.js';

/** Garante token ativo e não expirado para a vaga (cria uma linha em vacancy_links se precisar). */
export async function ensureActiveVacancyLinkToken(vacancyId) {
  const token = crypto.randomBytes(24).toString('hex');
  // The unique index includes expired active links. Renew the same token so
  // existing invitations remain usable, and concurrent sends share one link.
  const result = await query(
    `INSERT INTO vacancy_links (vacancy_id, token, active, expires_at)
     VALUES ($1, $2, TRUE, NOW() + INTERVAL '7 days')
     ON CONFLICT (vacancy_id) WHERE active = TRUE
     DO UPDATE SET expires_at = CASE
       WHEN vacancy_links.expires_at <= NOW() THEN EXCLUDED.expires_at
       ELSE vacancy_links.expires_at
     END
     RETURNING token`,
    [vacancyId, token]
  );
  return result.rows[0].token;
}
