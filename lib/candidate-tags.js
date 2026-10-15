import { ERR } from './api-error-codes.js';
import { query, withTransaction } from './db.js';
import {
  CANDIDATE_TAG_COLORS,
  normalizeTagIds,
  candidateTagsSelectSql,
} from './candidate-tags-core.js';

export async function listCandidateTags(companyId) {
  return (
    await query(
      `SELECT id, name, color, active FROM candidate_tags WHERE company_id = $1 ORDER BY lower(name), id`,
      [companyId],
    )
  ).rows;
}

export async function saveCandidateTag({ companyId, id, name, color, active = true, actorId }) {
  const cleanName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleanName || cleanName.length > 40 || !CANDIDATE_TAG_COLORS.includes(color))
    return { ok: false, errorCode: ERR.INVALID_DATA, status: 400 };
  try {
    const result = id
      ? await query(
          `UPDATE candidate_tags SET name=$3, color=$4, active=$5, updated_at=now() WHERE id=$1 AND company_id=$2 RETURNING id,name,color,active`,
          [id, companyId, cleanName, color, active],
        )
      : await query(
          `INSERT INTO candidate_tags(company_id,name,color,created_by_user_id,active) VALUES($1,$2,$3,$4,$5) RETURNING id,name,color,active`,
          [companyId, cleanName, color, actorId, active],
        );
    return result.rowCount
      ? { ok: true, tag: result.rows[0] }
      : { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };
  } catch (error) {
    if (error.code === '23505')
      return { ok: false, errorCode: ERR.CANDIDATE_TAG_NAME_EXISTS, status: 409 };
    throw error;
  }
}

export async function replaceCandidateTags(
  { companyId, candidateId, tagIds, actorId },
  transaction = withTransaction,
) {
  const ids = normalizeTagIds(tagIds);
  return transaction(async (client) => {
    const candidate = await client.query(
      `SELECT id FROM candidates WHERE id=$1 AND company_id=$2 FOR UPDATE`,
      [candidateId, companyId],
    );
    if (!candidate.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND, status: 404 };
    // Existing inactive assignments may remain; inactive labels cannot be newly assigned.
    const valid = await client.query(
      `SELECT t.id FROM candidate_tags t WHERE t.company_id=$1 AND t.id=ANY($2::bigint[])
      AND (t.active OR EXISTS (SELECT 1 FROM candidate_tag_assignments a WHERE a.company_id=t.company_id AND a.tag_id=t.id AND a.candidate_id=$3))
      FOR SHARE OF t`,
      [companyId, ids, candidateId],
    );
    if (valid.rowCount !== ids.length)
      return { ok: false, errorCode: ERR.INVALID_DATA, status: 400 };
    await client.query(
      `DELETE FROM candidate_tag_assignments WHERE company_id=$1 AND candidate_id=$2 AND NOT (tag_id=ANY($3::bigint[]))`,
      [companyId, candidateId, ids],
    );
    await client.query(
      `INSERT INTO candidate_tag_assignments(company_id,candidate_id,tag_id,assigned_by_user_id)
      SELECT $1,$2,unnest($3::bigint[]),$4 ON CONFLICT DO NOTHING`,
      [companyId, candidateId, ids, actorId],
    );
    const result = await client.query(
      `SELECT ${candidateTagsSelectSql('c')} AS tags FROM candidates c WHERE c.id=$1 AND c.company_id=$2`,
      [candidateId, companyId],
    );
    return { ok: true, tags: result.rows[0].tags };
  });
}
