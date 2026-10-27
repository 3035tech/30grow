/**
 * Company intranet posts (B-2712) — RH publishes; collaborators read.
 */

import { asDb } from '../ae/as-db.js';
import { loadPostAttachments } from './company-post-attachments.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { sanitizeRichTextHtml } from '../sanitize-html.js';

export const COMPANY_POST_TITLE_MAX = 200;
export const COMPANY_POST_PAGE_DEFAULT = 20;
export const COMPANY_POST_PAGE_MAX = 50;
export const COMPANY_POST_HOME_CAP = 5;

function trimTitle(raw) {
  return String(raw || '').trim().slice(0, COMPANY_POST_TITLE_MAX);
}

/**
 * @returns {Promise<{ ok: true, posts: object[], total: number } | { ok: false, errorCode }>}
 */
export async function listCompanyPosts(dbOrQuery, {
  companyId,
  page = 1,
  pageSize = COMPANY_POST_PAGE_DEFAULT,
  includeDeleted = false,
  q = '',
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  const size = Math.min(COMPANY_POST_PAGE_MAX, Math.max(1, Number(pageSize) || COMPANY_POST_PAGE_DEFAULT));
  const p = Math.max(1, Number(page) || 1);
  const offset = (p - 1) * size;
  const delClause = includeDeleted ? '' : 'AND p.deleted = FALSE';
  const term = String(q || '').trim().slice(0, 80);
  const params = [cid];
  let qClause = '';
  if (term) {
    params.push(`%${term.replace(/[%_]/g, '')}%`);
    qClause = `AND p.title ILIKE $${params.length}`;
  }
  params.push(size, offset);
  const lim = `$${params.length - 1}`;
  const off = `$${params.length}`;
  const countParams = term ? [cid, params[1]] : [cid];

  try {
    const countR = await db.query(
      `SELECT COUNT(*)::int AS n FROM company_posts p
       WHERE p.company_id = $1 ${delClause} ${qClause}`,
      countParams
    );
    const listR = await db.query(
      `SELECT p.id, p.title, p.body_html AS "bodyHtml", p.deleted,
              p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              p.created_by_user_id AS "createdByUserId",
              u.display_name AS "authorName"
       FROM company_posts p
       LEFT JOIN users u ON u.id = p.created_by_user_id
       WHERE p.company_id = $1 ${delClause} ${qClause}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${lim} OFFSET ${off}`,
      params
    );
    const files = await loadPostAttachments(db, cid, listR.rows.map(post => post.id));
    return {
      ok: true,
      posts: listR.rows.map(post => ({ ...post, attachments: files.get(String(post.id)) || [] })),
      total: countR.rows[0]?.n || 0,
      page: p,
      pageSize: size,
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, posts: [], total: 0, page: p, pageSize: size };
    throw err;
  }
}

export async function getCompanyPostsPreview(dbOrQuery, { companyId, limit = COMPANY_POST_HOME_CAP }) {
  const r = await listCompanyPosts(dbOrQuery, {
    companyId,
    page: 1,
    pageSize: Math.min(COMPANY_POST_HOME_CAP, Math.max(1, Number(limit) || COMPANY_POST_HOME_CAP)),
  });
  if (!r.ok) return r;
  return { ok: true, items: r.posts, total: r.total };
}

/**
 * @returns {Promise<{ ok: true, post: object } | { ok: false, errorCode }>}
 */
export async function createCompanyPost(dbOrQuery, { companyId, title, bodyHtml, createdByUserId }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const t = trimTitle(title);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  if (!t) return { ok: false, errorCode: ERR.INVALID_DATA };
  const html = sanitizeRichTextHtml(String(bodyHtml || '')) || '';
  const uid = Number(createdByUserId);
  try {
    const r = await db.query(
      `INSERT INTO company_posts (company_id, title, body_html, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, body_html AS "bodyHtml", deleted,
                 created_at AS "createdAt", updated_at AS "updatedAt",
                 created_by_user_id AS "createdByUserId"`,
      [cid, t, html, Number.isFinite(uid) && uid > 0 ? uid : null]
    );
    return { ok: true, post: r.rows[0] };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function updateCompanyPost(dbOrQuery, { companyId, postId, title, bodyHtml }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const id = Number(postId);
  const t = trimTitle(title);
  if (!Number.isFinite(cid) || !Number.isFinite(id) || !t) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const html = sanitizeRichTextHtml(String(bodyHtml || '')) || '';
  try {
    const r = await db.query(
      `UPDATE company_posts
       SET title = $3, body_html = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted = FALSE
       RETURNING id, title, body_html AS "bodyHtml", deleted,
                 created_at AS "createdAt", updated_at AS "updatedAt",
                 created_by_user_id AS "createdByUserId"`,
      [id, cid, t, html]
    );
    if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    return { ok: true, post: r.rows[0] };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function softDeleteCompanyPost(dbOrQuery, { companyId, postId }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const id = Number(postId);
  if (!Number.isFinite(cid) || !Number.isFinite(id)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    const r = await db.query(
      `UPDATE company_posts
       SET deleted = TRUE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND deleted = FALSE
       RETURNING id`,
      [id, cid]
    );
    if (r.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    return { ok: true };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}
