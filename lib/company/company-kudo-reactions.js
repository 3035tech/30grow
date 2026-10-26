import { query, withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { KUDO_REACTION_EMOJIS, KUDO_REACTORS_PAGE_SIZE } from '../kudo-reaction-options.js';

/** One batch query per feed page, regardless of the number of kudos. */
export async function loadKudoReactionSummaries(db, companyId, kudoIds, viewerCandidateId = null) {
  if (!kudoIds.length) return new Map();
  let result;
  try {
    result = await db.query(
      `SELECT r.kudo_id AS "kudoId", r.emoji, count(*)::int AS count,
              COALESCE(bool_or(r.candidate_id=$3),false) AS mine
       FROM company_kudo_reactions r
       JOIN company_kudos k ON k.id=r.kudo_id AND k.company_id=r.company_id AND k.deleted=false
       WHERE r.company_id=$1 AND r.kudo_id=ANY($2::bigint[])
       GROUP BY r.kudo_id,r.emoji ORDER BY r.kudo_id,r.emoji`,
      [companyId, kudoIds, viewerCandidateId]
    );
  } catch (error) {
    // During an additive rollout the old feed must remain readable.
    if (error.code === '42P01') return new Map();
    throw error;
  }
  const grouped = new Map();
  for (const row of result.rows) {
    const id = String(row.kudoId);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({ emoji: row.emoji, count: row.count, mine: row.mine });
  }
  return grouped;
}

/** PUT and DELETE are idempotent. Serialize against moderation of this kudo. */
export async function setKudoReaction({ companyId, kudoId, candidateId, emoji }, transaction = withTransaction) {
  if (![companyId, kudoId, candidateId].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)
      || (emoji !== null && !KUDO_REACTION_EMOJIS.includes(emoji))) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    return await transaction(async db => {
      const kudo = await db.query(
        'SELECT id FROM company_kudos WHERE company_id=$1 AND id=$2 AND deleted=false FOR UPDATE',
        [companyId, kudoId]
      );
      if (!kudo.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
      const employee = await db.query(
        `SELECT id FROM candidates WHERE company_id=$1 AND id=$2 AND employment_status=$3 FOR SHARE`,
        [companyId, candidateId, EMPLOYMENT_STATUS.EMPLOYEE]
      );
      if (!employee.rowCount) return { ok: false, errorCode: ERR.FORBIDDEN };
      if (emoji === null) {
        await db.query('DELETE FROM company_kudo_reactions WHERE company_id=$1 AND kudo_id=$2 AND candidate_id=$3', [companyId, kudoId, candidateId]);
      } else {
        await db.query(
          `INSERT INTO company_kudo_reactions(company_id,kudo_id,candidate_id,emoji) VALUES($1,$2,$3,$4)
           ON CONFLICT(company_id,kudo_id,candidate_id) DO UPDATE SET emoji=EXCLUDED.emoji,updated_at=now()`,
          [companyId, kudoId, candidateId, emoji]
        );
      }
      const summaries = await loadKudoReactionSummaries(db, companyId, [kudoId], candidateId);
      return { ok: true, reactions: summaries.get(String(kudoId)) || [] };
    });
  } catch (error) {
    if (error.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw error;
  }
}

/** Names are fetched on demand, never unbounded in the feed payload. */
export async function listKudoReactors({ companyId, kudoId, offset = 0, allowedEmojis = null }, db = { query }) {
  const kudo = await db.query('SELECT id FROM company_kudos WHERE company_id=$1 AND id=$2 AND deleted=false', [companyId, kudoId]);
  if (!kudo.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const pageOffset = Math.min(1000000, Math.max(0, Math.trunc(Number(offset) || 0)));
  const result = await db.query(
    `SELECT r.emoji,c.full_name AS "fullName"
     FROM company_kudo_reactions r
     JOIN candidates c ON c.company_id=r.company_id AND c.id=r.candidate_id
     JOIN company_kudos k ON k.company_id=r.company_id AND k.id=r.kudo_id AND k.deleted=false
     WHERE r.company_id=$1 AND r.kudo_id=$2 AND ($5::text[] IS NULL OR r.emoji=ANY($5::text[]))
     ORDER BY c.full_name,r.candidate_id LIMIT $3 OFFSET $4`,
    [companyId, kudoId, KUDO_REACTORS_PAGE_SIZE + 1, pageOffset, allowedEmojis]
  );
  return { ok: true, people: result.rows.slice(0, KUDO_REACTORS_PAGE_SIZE), hasMore: result.rows.length > KUDO_REACTORS_PAGE_SIZE };
}
