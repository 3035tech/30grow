import { ERR } from '../api-error-codes.js';

export const CANDIDATE_TAG_COLORS = Object.freeze([
  '#6366f1',
  '#a855f7',
  '#16a34a',
  '#0284c7',
  '#d97706',
  '#dc2626',
  '#64748b',
]);
export const MAX_CANDIDATE_TAGS = 30;

export function normalizeTagIds(raw) {
  const values = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(',')
        .filter(Boolean);
  const ids = [...new Set(values.map(Number))];
  if (ids.length > MAX_CANDIDATE_TAGS || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(ERR.INVALID_DATA);
  }
  return ids;
}

export function normalizeCandidateTagFilter(input = {}) {
  const tagMode = input.tagMode || 'any';
  if (!['any', 'all', 'none'].includes(tagMode)) throw new Error(ERR.INVALID_DATA);
  return { tagIds: normalizeTagIds(input.tagIds), tagMode };
}

/** SQL expressions accept only internal aliases. Bind values before pagination/count. */
export function candidateTagFilterSql(alias, input, params) {
  const { tagIds, tagMode } = normalizeCandidateTagFilter(input);
  const scope = `cta.candidate_id = ${alias}.id AND cta.company_id = ${alias}.company_id`;
  if (tagMode === 'none')
    return `NOT EXISTS (SELECT 1 FROM candidate_tag_assignments cta WHERE ${scope})`;
  if (!tagIds.length) return 'TRUE';
  params.push(tagIds);
  const selected = `cta.tag_id = ANY($${params.length}::bigint[])`;
  if (tagMode === 'all')
    return `(SELECT COUNT(*) FROM candidate_tag_assignments cta WHERE ${scope} AND ${selected}) = ${tagIds.length}`;
  return `EXISTS (SELECT 1 FROM candidate_tag_assignments cta WHERE ${scope} AND ${selected})`;
}

export function candidateTagsSelectSql(alias) {
  return `COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color, 'active', t.active) ORDER BY lower(t.name), t.id)
    FROM candidate_tag_assignments cta JOIN candidate_tags t ON t.id = cta.tag_id AND t.company_id = cta.company_id
    WHERE cta.candidate_id = ${alias}.id AND cta.company_id = ${alias}.company_id), '[]'::jsonb)`;
}
