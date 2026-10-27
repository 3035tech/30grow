/**
 * Peer kudos / recognition (B-2716) — employee → employee, company-visible.
 */

import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { loadKudoReactionSummaries } from './company-kudo-reactions.js';

export const KUDOS_MESSAGE_MAX = 280;
export const KUDOS_PAGE_DEFAULT = 20;
export const KUDOS_PAGE_MAX = 50;
export const KUDOS_HOME_CAP = 8;

function trimMessage(raw) {
  return String(raw || '').trim().slice(0, KUDOS_MESSAGE_MAX);
}

/**
 * @returns {Promise<{ ok: true, kudos: object[], total: number, page: number, pageSize: number } | { ok: false, errorCode }>}
 */
export async function listCompanyKudos(dbOrQuery, {
  companyId,
  page = 1,
  pageSize = KUDOS_PAGE_DEFAULT,
  toCandidateId = null,
  kudoId = null,
  viewerCandidateId = null,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  const size = Math.min(KUDOS_PAGE_MAX, Math.max(1, Number(pageSize) || KUDOS_PAGE_DEFAULT));
  const p = Math.max(1, Number(page) || 1);
  const offset = (p - 1) * size;
  const toId = toCandidateId != null ? Number(toCandidateId) : null;
  const params = [cid];
  let toClause = '';
  if (Number.isFinite(toId) && toId > 0) {
    params.push(toId);
    toClause = `AND k.to_candidate_id = $${params.length}`;
  }
  params.push(size, offset);
  if (kudoId !== null) {
    if (!Number.isSafeInteger(Number(kudoId)) || Number(kudoId) < 1) return { ok: false, errorCode: ERR.INVALID_DATA };
    params.splice(params.length - 2, 0, Number(kudoId));
    toClause += ` AND k.id = $${params.length - 2}`;
  }
  const lim = `$${params.length - 1}`;
  const off = `$${params.length}`;

  try {
    const countParams = params.slice(0, -2);
    const countR = await db.query(
      `SELECT COUNT(*)::int AS n FROM company_kudos k
       WHERE k.company_id = $1 AND k.deleted = FALSE ${toClause}`,
      countParams
    );
    const listR = await db.query(
      `SELECT k.id, k.message, k.created_at AS "createdAt",
              k.from_candidate_id AS "fromCandidateId",
              k.to_candidate_id AS "toCandidateId",
              f.full_name AS "fromName",
              t.full_name AS "toName"
       FROM company_kudos k
       JOIN candidates f ON f.id = k.from_candidate_id AND f.company_id = k.company_id
       JOIN candidates t ON t.id = k.to_candidate_id AND t.company_id = k.company_id
       WHERE k.company_id = $1 AND k.deleted = FALSE ${toClause}
       ORDER BY k.created_at DESC, k.id DESC
       LIMIT ${lim} OFFSET ${off}`,
      params
    );
    const reactions = await loadKudoReactionSummaries(db, cid, listR.rows.map(row => row.id), viewerCandidateId);
    return {
      ok: true,
      kudos: listR.rows.map(row => ({ ...row, reactions: reactions.get(String(row.id)) || [] })),
      total: countR.rows[0]?.n || 0,
      page: p,
      pageSize: size,
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, kudos: [], total: 0, page: p, pageSize: size };
    throw err;
  }
}

export async function getCompanyKudosPreview(dbOrQuery, { companyId, limit = KUDOS_HOME_CAP, viewerCandidateId = null }) {
  const r = await listCompanyKudos(dbOrQuery, {
    companyId,
    viewerCandidateId,
    page: 1,
    pageSize: Math.min(KUDOS_HOME_CAP, Math.max(1, Number(limit) || KUDOS_HOME_CAP)),
  });
  if (!r.ok) return r;
  return { ok: true, items: r.kudos, total: r.total };
}

/**
 * @returns {Promise<{ ok: true, kudo: object } | { ok: false, errorCode }>}
 */
export async function createCompanyKudo(dbOrQuery, {
  companyId,
  fromCandidateId,
  toCandidateId,
  message,
  idempotencyKey = null,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const fromId = Number(fromCandidateId);
  const toId = Number(toCandidateId);
  const msg = trimMessage(message);
  if (!Number.isFinite(cid) || !Number.isFinite(fromId) || !Number.isFinite(toId)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (fromId === toId) return { ok: false, errorCode: ERR.INVALID_DATA };
  if (!msg) return { ok: false, errorCode: ERR.INVALID_DATA };

  try {
    const peers = await db.query(
      `SELECT id FROM candidates
       WHERE company_id = $1
         AND id = ANY($2::bigint[])
         AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'`,
      [cid, [fromId, toId]]
    );
    if (peers.rowCount < 2) return { ok: false, errorCode: ERR.NOT_FOUND };

    const r = await db.query(
      `INSERT INTO company_kudos (company_id, from_candidate_id, to_candidate_id, message, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, from_candidate_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
         DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING id, message, created_at AS "createdAt",
                 from_candidate_id AS "fromCandidateId",
                 to_candidate_id AS "toCandidateId"`,
      [cid, fromId, toId, msg, idempotencyKey]
    );
    const row = r.rows[0];
    const names = await db.query(
      `SELECT id, full_name AS "fullName" FROM candidates WHERE id = ANY($1::bigint[])`,
      [[fromId, toId]]
    );
    const byId = Object.fromEntries(names.rows.map((n) => [n.id, n.fullName]));
    return {
      ok: true,
      kudo: {
        ...row,
        fromName: byId[fromId] || null,
        toName: byId[toId] || null,
      },
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function softDeleteCompanyKudo(dbOrQuery, { companyId, kudoId }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const id = Number(kudoId);
  if (!Number.isFinite(cid) || !Number.isFinite(id)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  try {
    const r = await db.query(
      `UPDATE company_kudos SET deleted = TRUE
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

/** Colleagues for kudos picker (same company employees). */
export async function searchEmployeeColleagues(dbOrQuery, {
  companyId,
  excludeCandidateId,
  q = '',
  limit = 20,
  offset = 0,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const exclude = Number(excludeCandidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(exclude)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const term = String(q || '').trim().slice(0, 80);
  const lim = Math.min(40, Math.max(1, Number(limit) || 20));
  const params = [cid, exclude];
  let nameClause = '';
  if (term) {
    params.push(`%${term.replace(/[%_]/g, '')}%`);
    nameClause = `AND c.full_name ILIKE $${params.length}`;
  }
  params.push(lim, Math.max(0, Math.trunc(Number(offset) || 0)));
  try {
    const r = await db.query(
      `SELECT c.id, c.full_name AS "fullName", c.email
       FROM candidates c
       WHERE c.company_id = $1
         AND c.id <> $2
         AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
         ${nameClause}
       ORDER BY c.full_name ASC, c.id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { ok: true, people: r.rows };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, people: [] };
    throw err;
  }
}

/** Count kudos created in the last N days (digest). */
export async function countRecentCompanyKudos(dbOrQuery, { companyId, days = 7 }) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const d = Math.min(30, Math.max(1, Number(days) || 7));
  if (!Number.isFinite(cid)) return 0;
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM company_kudos
       WHERE company_id = $1 AND deleted = FALSE
         AND created_at >= NOW() - ($2::int * INTERVAL '1 day')`,
      [cid, d]
    );
    return r.rows[0]?.n || 0;
  } catch (err) {
    if (err?.code === '42P01') return 0;
    throw err;
  }
}
