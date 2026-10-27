/**
 * Learning Resources — catálogo leve de ações/trilhas (B-1008, Epic B-1000).
 * Sem LMS, sem player, sem SCORM. PDI pode apontar para recursos.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { LEARNING_RESOURCE_TYPE, LEARNING_RESOURCE_TYPES } from '../domain-status.js';
import { formatTagList, parseTagList } from '../tag-list.js';
import { sanitizeRichTextHtml } from '../sanitize-html.js';

const TITLE_MAX = 300;
const DESC_MAX = 2000;
const THEME_LIST_MAX = 400;
const THEME_TAG_MAX = 40;
const LIST_CAP = 100;

const RESOURCE_TYPES = new Set(LEARNING_RESOURCE_TYPES);

function normalizeType(raw, fallback = LEARNING_RESOURCE_TYPE.COURSE) {
  const t = String(raw || '').trim().toLowerCase();
  return RESOURCE_TYPES.has(t) ? t : fallback;
}

function normalizeTheme(raw) {
  return formatTagList(raw, { tagMax: THEME_TAG_MAX, listMax: THEME_LIST_MAX });
}

/** Match a single theme token inside comma-separated theme TEXT. */
function themeTokenMatchSql(paramIndex) {
  return `(
    LOWER(btrim(theme)) = LOWER(btrim($${paramIndex}))
    OR LOWER(',' || REPLACE(REPLACE(theme, ', ', ','), ' ,', ',') || ',')
       LIKE '%,' || LOWER(btrim($${paramIndex})) || ',%'
  )`;
}

// ========================================
// LEARNING RESOURCES CRUD
// ========================================

/**
 * List learning resources for a company.
 */
export async function listLearningResources(dbOrQuery, { companyId, includeInactive = false, theme = null, resourceType = null, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);

  let where = 'company_id = $1';
  const params = [companyId];
  let paramIndex = 2;

  if (!includeInactive) {
    where += ' AND active = TRUE';
  }

  if (theme) {
    where += ` AND ${themeTokenMatchSql(paramIndex)}`;
    params.push(String(theme).trim());
    paramIndex++;
  }

  if (resourceType && RESOURCE_TYPES.has(String(resourceType).toLowerCase())) {
    where += ` AND resource_type = $${paramIndex}`;
    params.push(String(resourceType).toLowerCase());
    paramIndex++;
  }

  const res = await db.query(
    `SELECT id, title, description, theme, resource_type AS "resourceType",
            url, duration_hours AS "durationHours", active,
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM learning_resources
     WHERE ${where}
     ORDER BY active DESC, updated_at DESC, id DESC
     LIMIT $${paramIndex}`,
    [...params, cap]
  );

  return res.rows;
}

/**
 * Get a single learning resource.
 */
export async function getLearningResource(dbOrQuery, { companyId, resourceId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT id, title, description, theme, resource_type AS "resourceType",
            url, duration_hours AS "durationHours", active,
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM learning_resources
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [resourceId, companyId]
  );
  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Create a learning resource.
 */
export async function createLearningResource(dbOrQuery, {
  companyId,
  title,
  description = '',
  theme = null,
  resourceType = LEARNING_RESOURCE_TYPE.COURSE,
  url = null,
  durationHours = null,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);

  const safeTitle = String(title || '').trim().slice(0, TITLE_MAX);
  if (safeTitle.length === 0) {
    return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  }

  const safeDesc = sanitizeRichTextHtml(description || '', DESC_MAX) || '';
  const safeTheme = normalizeTheme(theme);
  const safeType = normalizeType(resourceType, LEARNING_RESOURCE_TYPE.COURSE);
  const safeUrl = url ? String(url).trim() : null;
  const safeDuration = durationHours && Number(durationHours) > 0 ? Math.min(Math.max(1, Number(durationHours)), 1000) : null;

  const res = await db.query(
    `INSERT INTO learning_resources (
       company_id, title, description, theme, resource_type, url, duration_hours, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, title, description, theme, resource_type AS "resourceType",
               url, duration_hours AS "durationHours", active,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [companyId, safeTitle, safeDesc, safeTheme, safeType, safeUrl, safeDuration, createdByUserId || null]
  );

  return { ok: true, resource: res.rows[0] };
}

/**
 * Update a learning resource.
 */
export async function updateLearningResource(dbOrQuery, {
  companyId,
  resourceId,
  title,
  description,
  theme,
  resourceType,
  url,
  durationHours,
  active,
}) {
  const db = asDb(dbOrQuery);

  const existing = await getLearningResource(db, { companyId, resourceId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  const nextTitle = title !== undefined ? String(title || '').trim().slice(0, TITLE_MAX) : existing.title;
  if (nextTitle.length === 0) {
    return { ok: false, errorCode: ERR.TITLE_REQUIRED };
  }

  const nextDesc = description !== undefined
    ? (sanitizeRichTextHtml(description || '', DESC_MAX) || '')
    : existing.description;
  const nextTheme = theme !== undefined ? normalizeTheme(theme) : existing.theme;
  const nextType = resourceType !== undefined ? normalizeType(resourceType, existing.resourceType) : existing.resourceType;
  const nextUrl = url !== undefined ? (url ? String(url).trim() : null) : existing.url;
  const nextDuration = durationHours !== undefined
    ? (durationHours && Number(durationHours) > 0 ? Math.min(Math.max(1, Number(durationHours)), 1000) : null)
    : existing.durationHours;
  const nextActive = active !== undefined ? !!active : existing.active;

  const res = await db.query(
    `UPDATE learning_resources
     SET title = $2, description = $3, theme = $4, resource_type = $5,
         url = $6, duration_hours = $7, active = $8, updated_at = NOW()
     WHERE id = $1
     RETURNING id, title, description, theme, resource_type AS "resourceType",
               url, duration_hours AS "durationHours", active,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [resourceId, nextTitle, nextDesc, nextTheme, nextType, nextUrl, nextDuration, nextActive]
  );

  return { ok: true, resource: res.rows[0] };
}

/**
 * Deactivate (soft delete) a learning resource.
 */
export async function deactivateLearningResource(dbOrQuery, { companyId, resourceId }) {
  const db = asDb(dbOrQuery);
  const existing = await getLearningResource(db, { companyId, resourceId });
  if (!existing) return { ok: false, errorCode: ERR.NOT_FOUND };

  await db.query(
    `UPDATE learning_resources SET active = FALSE, updated_at = NOW() WHERE id = $1`,
    [resourceId]
  );

  return { ok: true };
}

/**
 * Get distinct theme tags used in a company (for filtering / suggestions).
 */
export async function getCompanyLearningThemes(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT theme
     FROM learning_resources
     WHERE company_id = $1 AND active = TRUE AND theme IS NOT NULL AND btrim(theme) <> ''
     LIMIT ${LIST_CAP}`,
    [companyId]
  );
  const seen = new Set();
  const out = [];
  for (const row of res.rows) {
    for (const tag of parseTagList(row.theme, { tagMax: THEME_TAG_MAX, listMax: THEME_LIST_MAX })) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  out.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  return out;
}

// ========================================
// PDI RESOURCE LINKS (optional)
// ========================================

/**
 * Link a learning resource to a PDI item (same company).
 */
export async function linkResourceToPdi(dbOrQuery, { companyId, planItemId, resourceId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const itemId = Number(planItemId);
  const rid = Number(resourceId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(rid) || rid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const scoped = await db.query(
    `SELECT 1
     FROM development_plan_items i
     JOIN learning_resources lr ON lr.id = $2 AND lr.company_id = i.company_id
     WHERE i.id = $1 AND i.company_id = $3 AND lr.active = TRUE
     LIMIT 1`,
    [itemId, rid, cid]
  );
  if (scoped.rowCount === 0) return { ok: false, errorCode: ERR.INVALID_REFERENCE };
  try {
    await db.query(
      `INSERT INTO development_plan_resource_links (plan_item_id, resource_id)
       VALUES ($1, $2)
       ON CONFLICT (plan_item_id, resource_id) DO NOTHING`,
      [itemId, rid]
    );
    return { ok: true };
  } catch (err) {
    if (err?.code === '23503') return { ok: false, errorCode: ERR.INVALID_REFERENCE };
    throw err;
  }
}

/**
 * Unlink a learning resource from a PDI item.
 */
export async function unlinkResourceFromPdi(dbOrQuery, { companyId, planItemId, resourceId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const itemId = Number(planItemId);
  const rid = Number(resourceId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(itemId) || itemId <= 0 || !Number.isFinite(rid) || rid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  await db.query(
    `DELETE FROM development_plan_resource_links dprl
     USING development_plan_items i
     WHERE dprl.plan_item_id = i.id
       AND dprl.plan_item_id = $1
       AND dprl.resource_id = $2
       AND i.company_id = $3`,
    [itemId, rid, cid]
  );
  return { ok: true };
}

/**
 * Get learning resources linked to a PDI item.
 */
export async function getPdiLinkedResources(dbOrQuery, { planItemId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT lr.id, lr.title, lr.description, lr.theme, lr.resource_type AS "resourceType",
            lr.url, lr.duration_hours AS "durationHours"
     FROM development_plan_resource_links dprl
     JOIN learning_resources lr ON lr.id = dprl.resource_id
     WHERE dprl.plan_item_id = $1 AND lr.active = TRUE
     ORDER BY dprl.created_at ASC`,
    [planItemId]
  );
  return res.rows;
}

export const LEARNING_RESOURCE_CAPS = {
  LIST_CAP,
  RESOURCE_TYPES,
};
