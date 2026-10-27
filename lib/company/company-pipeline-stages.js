/**
 * B-RH2-12: per-company recruiting pipeline stages.
 *
 * Data lives in `company_pipeline_stages`; on first read for a company we
 * lazy-seed the 8 defaults (matching the historical hard-coded funnel).
 *
 * Contract:
 *  - `stage_key` is stored in vacancy_candidates.pipeline_stage / assessments.pipeline_stage.
 *  - Seed stages reuse the canonical key as their stage_key (backwards compatible with legacy rows).
 *  - Custom stages use `c_<slug>` and carry a `canonical_key` for report aggregation and
 *    to drive special actions (hired/rejected/archived flows).
 *  - Required stages (new, test_completed, hired, rejected, archived) cannot be deleted.
 *  - Editable seed stages (interview, screening, approved) can be renamed, reordered
 *    and soft-deleted if empty.
 */

import { asDb } from '../ae/as-db.js';
import { pool } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { PIPELINE_STAGE } from '../recruiting/pipeline.js';

export const PIPELINE_CANONICAL_KEYS = Object.freeze([
  PIPELINE_STAGE.NEW,
  PIPELINE_STAGE.INTERVIEW,
  PIPELINE_STAGE.TEST_COMPLETED,
  PIPELINE_STAGE.SCREENING,
  PIPELINE_STAGE.APPROVED,
  PIPELINE_STAGE.HIRED,
  PIPELINE_STAGE.REJECTED,
  PIPELINE_STAGE.ARCHIVED,
]);

const CANONICAL_SET = new Set(PIPELINE_CANONICAL_KEYS);

/**
 * Default seed shipped on first read. Order = historical Kanban order.
 * `required=true` = required by acceptance (never deletable).
 * `system=true` = seed row (labels/order editable).
 */
export const PIPELINE_STAGE_SEED = Object.freeze([
  { key: PIPELINE_STAGE.NEW,            pt: 'Novo',              en: 'New',            required: true  },
  { key: PIPELINE_STAGE.INTERVIEW,      pt: 'Entrevista',        en: 'Interview',      required: false },
  { key: PIPELINE_STAGE.TEST_COMPLETED, pt: 'Teste concluído',   en: 'Test completed', required: true  },
  { key: PIPELINE_STAGE.SCREENING,      pt: 'Triagem',           en: 'Screening',      required: false },
  { key: PIPELINE_STAGE.APPROVED,       pt: 'Aprovado',          en: 'Approved',       required: false },
  { key: PIPELINE_STAGE.HIRED,          pt: 'Contratado',        en: 'Hired',          required: true  },
  { key: PIPELINE_STAGE.REJECTED,       pt: 'Reprovado',         en: 'Rejected',       required: true  },
  { key: PIPELINE_STAGE.ARCHIVED,       pt: 'Arquivado',         en: 'Archived',       required: true  },
]);

const MAX_LABEL_LEN = 60;
const MAX_STAGE_KEY_LEN = 64;

function toCompanyId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function trimLabel(v) {
  if (v == null) return '';
  return String(v).trim().slice(0, MAX_LABEL_LEN);
}

function normalizeCanonical(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return CANONICAL_SET.has(s) ? s : null;
}

/**
 * Slugify a label into a stable custom stage_key like `c_analise_da_gestao`.
 * Removes accents, non [a-z0-9] → `_`, trims separators, forces `c_` prefix,
 * caps at 64 chars. Collisions handled by suffix in `create()`.
 */
export function slugifyStageKey(label) {
  const raw = String(label ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const trimmed = raw.slice(0, MAX_STAGE_KEY_LEN - 2);
  return trimmed ? `c_${trimmed}` : 'c_stage';
}

function rowToStage(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    stageKey: row.stage_key,
    labelPt: row.label_pt,
    labelEn: row.label_en,
    sortOrder: Number(row.sort_order),
    canonicalKey: row.canonical_key,
    system: !!row.system,
    required: !!row.required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readStages(client, companyId) {
  const res = await client.query(
    `SELECT id, company_id, stage_key, label_pt, label_en, sort_order,
            canonical_key, system, required, created_at, updated_at
       FROM company_pipeline_stages
      WHERE company_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
    [companyId]
  );
  return res.rows.map(rowToStage);
}

async function seedIfEmpty(client, companyId) {
  const existing = await client.query(
    `SELECT 1 FROM company_pipeline_stages WHERE company_id = $1 LIMIT 1`,
    [companyId]
  );
  if (existing.rowCount > 0) return;
  const values = [];
  const params = [companyId];
  PIPELINE_STAGE_SEED.forEach((s, idx) => {
    const base = params.length;
    params.push(s.key, s.pt, s.en, idx, s.key, s.required);
    values.push(`($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, TRUE, $${base + 6})`);
  });
  await client.query(
    `INSERT INTO company_pipeline_stages
       (company_id, stage_key, label_pt, label_en, sort_order, canonical_key, system, required)
     VALUES ${values.join(', ')}
     ON CONFLICT DO NOTHING`,
    params
  );
}

/**
 * List active stages for a company; lazy-seeds on first read.
 * Uses primary pool (needs seed write); safe to call from read paths.
 */
export async function listCompanyPipelineStages(companyId, dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return [];
  const db = asDb(dbOrQuery);
  try {
    const first = await readStages(db, cid);
    if (first.length > 0) return first;
  } catch (err) {
    if (err?.code === '42P01') return []; // pre-migration 110
    throw err;
  }
  // Empty → seed under a single-connection transaction to avoid duplicate seed under concurrency.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `LOCK TABLE company_pipeline_stages IN SHARE ROW EXCLUSIVE MODE`
    );
    await seedIfEmpty(client, cid);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err?.code !== '23505') throw err; // ignore concurrent seed race
  } finally {
    client.release();
  }
  return readStages(db, cid);
}

/** Returns the stage matching `stageKey` for the company, or null. */
export async function resolveCompanyPipelineStage(companyId, stageKey, dbOrQuery) {
  if (stageKey == null) return null;
  const stages = await listCompanyPipelineStages(companyId, dbOrQuery);
  return stages.find((s) => s.stageKey === stageKey) || null;
}

/** Returns canonical key for a stored stage_key, falling back to the key itself when legacy/unknown. */
export function canonicalOfStageKey(stages, stageKey) {
  if (!stageKey) return null;
  const found = stages.find((s) => s.stageKey === stageKey);
  if (found) return found.canonicalKey;
  return CANONICAL_SET.has(stageKey) ? stageKey : null;
}

async function countStageUsage(client, companyId, stageKey) {
  const res = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM vacancy_candidates
         WHERE company_id = $1 AND pipeline_stage = $2)::int AS vc,
       (SELECT COUNT(*) FROM assessments
         WHERE company_id = $1 AND pipeline_stage = $2)::int AS ass`,
    [companyId, stageKey]
  );
  const { vc = 0, ass = 0 } = res.rows[0] || {};
  return vc + ass;
}

/** Create a custom stage. Auto-generates a `c_<slug>` key (collision suffix on retry). */
export async function createCompanyPipelineStage({ companyId, labelPt, labelEn, canonicalKey }, dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  const pt = trimLabel(labelPt);
  const en = trimLabel(labelEn) || pt;
  if (!pt) return { ok: false, errorCode: ERR.PIPELINE_STAGE_LABEL_REQUIRED };
  const canonical = normalizeCanonical(canonicalKey) || PIPELINE_STAGE.SCREENING;

  await listCompanyPipelineStages(cid, dbOrQuery); // ensure seed
  const db = asDb(dbOrQuery);
  const base = slugifyStageKey(pt);
  const nextOrderRes = await db.query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
       FROM company_pipeline_stages
      WHERE company_id = $1 AND deleted_at IS NULL`,
    [cid]
  );
  const nextOrder = Number(nextOrderRes.rows[0]?.next || 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const key = attempt === 0
      ? base
      : `${base.slice(0, MAX_STAGE_KEY_LEN - 4)}_${attempt + 1}`;
    try {
      const res = await db.query(
        `INSERT INTO company_pipeline_stages
           (company_id, stage_key, label_pt, label_en, sort_order,
            canonical_key, system, required)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, FALSE)
         RETURNING id, company_id, stage_key, label_pt, label_en, sort_order,
                   canonical_key, system, required, created_at, updated_at`,
        [cid, key, pt, en, nextOrder, canonical]
      );
      return { ok: true, stage: rowToStage(res.rows[0]) };
    } catch (err) {
      if (err?.code === '23505') continue;
      if (err?.code === '23514') return { ok: false, errorCode: ERR.PIPELINE_STAGE_LABEL_REQUIRED };
      throw err;
    }
  }
  return { ok: false, errorCode: ERR.PIPELINE_STAGE_KEY_EXISTS };
}

/**
 * Update a stage's label and/or canonical_key. Never mutates stage_key,
 * system, required or sort_order (reorder is a separate endpoint).
 * Required-stage canonical_key is locked to preserve special actions.
 */
export async function updateCompanyPipelineStage({ companyId, id, labelPt, labelEn, canonicalKey }, dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  const stageId = Number(id);
  if (!Number.isFinite(stageId) || stageId <= 0) return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };

  const db = asDb(dbOrQuery);
  const existingRes = await db.query(
    `SELECT id, company_id, stage_key, label_pt, label_en, sort_order,
            canonical_key, system, required, created_at, updated_at
       FROM company_pipeline_stages
      WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [cid, stageId]
  );
  if (existingRes.rowCount === 0) return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
  const current = rowToStage(existingRes.rows[0]);

  const nextPt = labelPt !== undefined ? trimLabel(labelPt) : current.labelPt;
  const nextEn = labelEn !== undefined ? (trimLabel(labelEn) || nextPt) : current.labelEn;
  if (!nextPt) return { ok: false, errorCode: ERR.PIPELINE_STAGE_LABEL_REQUIRED };

  let nextCanonical = current.canonicalKey;
  if (canonicalKey !== undefined && !current.required) {
    const c = normalizeCanonical(canonicalKey);
    if (!c) return { ok: false, errorCode: ERR.PIPELINE_STAGE_INVALID_CANONICAL };
    nextCanonical = c;
  }

  const res = await db.query(
    `UPDATE company_pipeline_stages
        SET label_pt = $3,
            label_en = $4,
            canonical_key = $5,
            updated_at = NOW()
      WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
      RETURNING id, company_id, stage_key, label_pt, label_en, sort_order,
                canonical_key, system, required, created_at, updated_at`,
    [cid, stageId, nextPt, nextEn, nextCanonical]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
  return { ok: true, stage: rowToStage(res.rows[0]) };
}

/**
 * Bulk reorder. `orderedIds` = full list of stage ids in desired display order.
 * Missing/extra ids are ignored; sort_order is rewritten as 0..n-1 in one tx.
 */
export async function reorderCompanyPipelineStages({ companyId, orderedIds }, _dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  const ids = Array.isArray(orderedIds)
    ? orderedIds.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (ids.length === 0) return { ok: false, errorCode: ERR.INVALID_PARAMS };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query(
      `SELECT id FROM company_pipeline_stages
        WHERE company_id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [cid]
    );
    const known = new Set(existingRes.rows.map((r) => Number(r.id)));
    const applied = ids.filter((id) => known.has(id));
    for (let i = 0; i < applied.length; i++) {
      await client.query(
        `UPDATE company_pipeline_stages
            SET sort_order = $3, updated_at = NOW()
          WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [cid, applied[i], i]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { ok: true, stages: await listCompanyPipelineStages(cid) };
}

/**
 * Soft delete. Blocked when:
 *  - stage is required (never deletable), or
 *  - any candidate row (vacancy_candidates OR assessments) still holds this stage_key
 *    for the company.
 */
export async function deleteCompanyPipelineStage({ companyId, id }, dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return { ok: false, errorCode: ERR.INVALID_COMPANY };
  const stageId = Number(id);
  if (!Number.isFinite(stageId) || stageId <= 0) return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingRes = await client.query(
      `SELECT id, stage_key, required
         FROM company_pipeline_stages
        WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [cid, stageId]
    );
    if (existingRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.PIPELINE_STAGE_NOT_FOUND };
    }
    const { stage_key: stageKey, required } = existingRes.rows[0];
    if (required) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.PIPELINE_STAGE_REQUIRED };
    }
    const usage = await countStageUsage(client, cid, stageKey);
    if (usage > 0) {
      await client.query('ROLLBACK');
      return { ok: false, errorCode: ERR.PIPELINE_STAGE_IN_USE, usage };
    }
    await client.query(
      `UPDATE company_pipeline_stages
          SET deleted_at = NOW(), updated_at = NOW()
        WHERE company_id = $1 AND id = $2`,
      [cid, stageId]
    );
    await client.query('COMMIT');
    return { ok: true, id: stageId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * SQL fragment: LEFT JOIN to resolve canonical_key for the given table alias.
 * Aliases the joined table as `cps_<alias>` to avoid clashes when multiple
 * joins are needed in one query.
 */
export function canonicalStageJoinSql(alias) {
  return `LEFT JOIN company_pipeline_stages cps_${alias}
    ON cps_${alias}.company_id = ${alias}.company_id
   AND cps_${alias}.stage_key = ${alias}.pipeline_stage
   AND cps_${alias}.deleted_at IS NULL`;
}

/**
 * SQL fragment: expression that resolves to the canonical stage key for the
 * given table alias. Falls back to the raw stage_key for legacy rows / seed
 * stages (where stage_key == canonical_key).
 */
export function canonicalStageExprSql(alias) {
  return `COALESCE(cps_${alias}.canonical_key, ${alias}.pipeline_stage)`;
}

/** Read stage counts (vacancy_candidates + assessments) grouped by stage_key. */
export async function readCompanyStageUsageMap(companyId, dbOrQuery) {
  const cid = toCompanyId(companyId);
  if (!cid) return {};
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT stage_key, SUM(n)::int AS n FROM (
       SELECT pipeline_stage AS stage_key, COUNT(*)::int AS n
         FROM vacancy_candidates
        WHERE company_id = $1 AND pipeline_stage IS NOT NULL
        GROUP BY pipeline_stage
       UNION ALL
       SELECT pipeline_stage AS stage_key, COUNT(*)::int AS n
         FROM assessments
        WHERE company_id = $1
        GROUP BY pipeline_stage
     ) AS u
     GROUP BY stage_key`,
    [cid]
  );
  const out = {};
  for (const r of res.rows) out[r.stage_key] = Number(r.n) || 0;
  return out;
}
