import { asDb } from '../ae/as-db.js';
import { query, withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

export const POST_REACTION_EMOJIS = Object.freeze(['👍', '❤️', '👏', '🎉', '🙌']);
export const POST_COMMENT_MAX = 1000;
export const POST_COMMENT_PAGE_SIZE = 20;

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

async function activePost(db, companyId, postId, lock = false) {
  const result = await db.query(
    `SELECT id FROM company_posts WHERE company_id=$1 AND id=$2 AND deleted=false${lock ? ' FOR UPDATE' : ''}`,
    [companyId, postId]
  );
  return result.rowCount > 0;
}

async function activeEmployee(db, companyId, candidateId) {
  const result = await db.query(
    'SELECT id FROM candidates WHERE company_id=$1 AND id=$2 AND employment_status=$3 FOR SHARE',
    [companyId, candidateId, EMPLOYMENT_STATUS.EMPLOYEE]
  );
  return result.rowCount > 0;
}

/** Batch summaries keep feed pagination to two extra queries. Missing new tables preserve old feed reads. */
export async function loadPostInteractionSummaries(db, companyId, postIds, viewerCandidateId = null) {
  const grouped = new Map();
  if (!postIds.length) return grouped;
  try {
    const [reactions, comments] = await Promise.all([
      db.query(
        `SELECT post_id AS "postId", emoji, count(*)::int AS count,
                COALESCE(bool_or(candidate_id=$3), false) AS mine
         FROM company_post_reactions
         WHERE company_id=$1 AND post_id=ANY($2::bigint[])
         GROUP BY post_id, emoji`,
        [companyId, postIds, viewerCandidateId]
      ),
      db.query(
        `SELECT post_id AS "postId", count(*)::int AS count
         FROM company_post_comments
         WHERE company_id=$1 AND post_id=ANY($2::bigint[]) AND deleted=false
         GROUP BY post_id`,
        [companyId, postIds]
      ),
    ]);
    for (const row of reactions.rows) {
      const id = String(row.postId);
      if (!grouped.has(id)) grouped.set(id, { reactions: [], commentCount: 0 });
      grouped.get(id).reactions.push({ emoji: row.emoji, count: row.count, mine: row.mine });
    }
    for (const row of comments.rows) {
      const id = String(row.postId);
      if (!grouped.has(id)) grouped.set(id, { reactions: [], commentCount: 0 });
      grouped.get(id).commentCount = row.count;
    }
  } catch (error) {
    if (error.code === '42P01') return new Map();
    throw error;
  }
  return grouped;
}

export async function setPostReaction({ companyId, postId, candidateId, emoji }, transaction = withTransaction) {
  if (![companyId, postId, candidateId].every(validId) || (emoji !== null && !POST_REACTION_EMOJIS.includes(emoji))) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    return await transaction(async db => {
      if (!await activePost(db, companyId, postId, true)) return { ok: false, errorCode: ERR.NOT_FOUND };
      if (!await activeEmployee(db, companyId, candidateId)) return { ok: false, errorCode: ERR.FORBIDDEN };
      if (emoji === null) {
        await db.query('DELETE FROM company_post_reactions WHERE company_id=$1 AND post_id=$2 AND candidate_id=$3', [companyId, postId, candidateId]);
      } else {
        await db.query(
          `INSERT INTO company_post_reactions(company_id,post_id,candidate_id,emoji) VALUES($1,$2,$3,$4)
           ON CONFLICT(company_id,post_id,candidate_id) DO UPDATE SET emoji=EXCLUDED.emoji,updated_at=now()`,
          [companyId, postId, candidateId, emoji]
        );
      }
      const summaries = await loadPostInteractionSummaries(db, companyId, [postId], candidateId);
      return { ok: true, reactions: summaries.get(String(postId))?.reactions || [] };
    });
  } catch (error) {
    if (error.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw error;
  }
}

export async function listPostComments({ companyId, postId, candidateId, offset = 0 }) {
  if (![companyId, postId, candidateId].every(validId)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const db = asDb(query);
  try {
    if (!await activePost(db, companyId, postId)) return { ok: false, errorCode: ERR.NOT_FOUND };
    const pageOffset = Math.min(100000, Math.max(0, Math.trunc(Number(offset) || 0)));
    const result = await db.query(
      `SELECT pc.id, pc.body, pc.created_at AS "createdAt", c.full_name AS "authorName",
              pc.candidate_id=$3 AS mine
       FROM company_post_comments pc
       JOIN candidates c ON c.company_id=pc.company_id AND c.id=pc.candidate_id
       WHERE pc.company_id=$1 AND pc.post_id=$2 AND pc.deleted=false
       ORDER BY pc.created_at DESC, pc.id DESC LIMIT $4 OFFSET $5`,
      [companyId, postId, candidateId, POST_COMMENT_PAGE_SIZE + 1, pageOffset]
    );
    return { ok: true, comments: result.rows.slice(0, POST_COMMENT_PAGE_SIZE), hasMore: result.rows.length > POST_COMMENT_PAGE_SIZE };
  } catch (error) {
    if (error.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw error;
  }
}

export async function createPostComment({ companyId, postId, candidateId, body }, transaction = withTransaction) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (![companyId, postId, candidateId].every(validId) || !text || text.length > POST_COMMENT_MAX) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    return await transaction(async db => {
      if (!await activePost(db, companyId, postId, true)) return { ok: false, errorCode: ERR.NOT_FOUND };
      if (!await activeEmployee(db, companyId, candidateId)) return { ok: false, errorCode: ERR.FORBIDDEN };
      const result = await db.query(
        `INSERT INTO company_post_comments(company_id,post_id,candidate_id,body)
         VALUES($1,$2,$3,$4) RETURNING id`,
        [companyId, postId, candidateId, text]
      );
      return { ok: true, id: result.rows[0].id };
    });
  } catch (error) {
    if (error.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw error;
  }
}

export async function deleteOwnPostComment({ companyId, postId, candidateId, commentId }) {
  if (![companyId, postId, candidateId, commentId].every(validId)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const db = asDb(query);
  try {
    const result = await db.query(
      `UPDATE company_post_comments pc SET deleted=true
       FROM company_posts p
       WHERE pc.id=$4 AND pc.company_id=$1 AND pc.post_id=$2 AND pc.candidate_id=$3
         AND pc.deleted=false AND p.id=pc.post_id AND p.company_id=pc.company_id AND p.deleted=false
       RETURNING pc.id`,
      [companyId, postId, candidateId, commentId]
    );
    return result.rowCount ? { ok: true } : { ok: false, errorCode: ERR.NOT_FOUND };
  } catch (error) {
    if (error.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw error;
  }
}
