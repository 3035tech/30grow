/**
 * B-3010 — Feedback contínuo estruturado (pedir / dar / receber). Não é kudos nem feed.
 */

import crypto from 'crypto';
import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS, FEEDBACK_REQUEST_STATUS } from '../domain-status.js';

export const FEEDBACK_MONTHLY_CAP = 10;
export const FEEDBACK_PROMPT_MAX = 500;
export const FEEDBACK_RESPONSE_MAX = 1000;
export const FEEDBACK_TTL_DAYS = 14;
export const FEEDBACK_LIST_CAP = 40;

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function mapRequest(r) {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    subjectCandidateId: Number(r.subjectCandidateId),
    fromCandidateId: Number(r.fromCandidateId),
    toCandidateId: Number(r.toCandidateId),
    subjectName: r.subjectName || null,
    fromName: r.fromName || null,
    toName: r.toName || null,
    prompt: r.prompt || '',
    token: r.token,
    status: r.status,
    responseText: r.responseText || '',
    answeredAt: r.answeredAt || null,
    expiresAt: r.expiresAt || null,
    createdAt: r.createdAt,
    publicPath: `/feedback/${r.token}`,
  };
}

async function assertEmployee(db, companyId, candidateId) {
  const res = await db.query(
    `SELECT id FROM candidates
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [candidateId, companyId]
  );
  return res.rowCount > 0;
}

export async function createFeedbackRequest(dbOrQuery, {
  companyId,
  fromCandidateId,
  toCandidateId,
  subjectCandidateId = null,
  prompt = '',
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const fromId = Number(fromCandidateId);
  const toId = Number(toCandidateId);
  const subjectId = subjectCandidateId != null ? Number(subjectCandidateId) : fromId;

  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || !Number.isFinite(subjectId)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (fromId === toId) return { ok: false, errorCode: ERR.INVALID_DATA };

  const promptText = String(prompt || '').trim().slice(0, FEEDBACK_PROMPT_MAX);

  const okFrom = await assertEmployee(db, cid, fromId);
  const okTo = await assertEmployee(db, cid, toId);
  const okSub = await assertEmployee(db, cid, subjectId);
  if (!okFrom || !okTo || !okSub) return { ok: false, errorCode: ERR.INVALID_DATA };

  try {
    const countR = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM feedback_requests
       WHERE company_id = $1
         AND from_candidate_id = $2
         AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC')`,
      [cid, fromId]
    );
    if ((countR.rows[0]?.n || 0) >= FEEDBACK_MONTHLY_CAP) {
      return { ok: false, errorCode: ERR.RATE_LIMIT };
    }

    const token = generateToken();
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + FEEDBACK_TTL_DAYS);

    const res = await db.query(
      `INSERT INTO feedback_requests (
         company_id, subject_candidate_id, from_candidate_id, to_candidate_id,
         prompt, token, status, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, company_id AS "companyId",
                 subject_candidate_id AS "subjectCandidateId",
                 from_candidate_id AS "fromCandidateId",
                 to_candidate_id AS "toCandidateId",
                 prompt, token, status,
                 response_text AS "responseText",
                 answered_at AS "answeredAt",
                 expires_at AS "expiresAt",
                 created_at AS "createdAt"`,
      [
        cid,
        subjectId,
        fromId,
        toId,
        promptText,
        token,
        FEEDBACK_REQUEST_STATUS.PENDING,
        expires.toISOString(),
      ]
    );
    const row = res.rows[0];
    return { ok: true, request: mapRequest({ ...row, subjectName: null, fromName: null, toName: null }) };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function listFeedbackForSubject(dbOrQuery, {
  companyId,
  subjectCandidateId,
  limit = FEEDBACK_LIST_CAP,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const sid = Number(subjectCandidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(sid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const cap = Math.min(FEEDBACK_LIST_CAP, Math.max(1, Number(limit) || FEEDBACK_LIST_CAP));

  try {
    const res = await db.query(
      `SELECT f.id, f.company_id AS "companyId",
              f.subject_candidate_id AS "subjectCandidateId",
              f.from_candidate_id AS "fromCandidateId",
              f.to_candidate_id AS "toCandidateId",
              s.full_name AS "subjectName",
              fr.full_name AS "fromName",
              t.full_name AS "toName",
              f.prompt, f.token, f.status,
              f.response_text AS "responseText",
              f.answered_at AS "answeredAt",
              f.expires_at AS "expiresAt",
              f.created_at AS "createdAt"
       FROM feedback_requests f
       JOIN candidates s ON s.id = f.subject_candidate_id AND s.company_id = f.company_id
       JOIN candidates fr ON fr.id = f.from_candidate_id AND fr.company_id = f.company_id
       JOIN candidates t ON t.id = f.to_candidate_id AND t.company_id = f.company_id
       WHERE f.company_id = $1 AND f.subject_candidate_id = $2
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $3`,
      [cid, sid, cap]
    );
    return { ok: true, items: res.rows.map(mapRequest) };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, items: [] };
    throw err;
  }
}

/** Requests created by the employee, with their current status and response. */
export async function listFeedbackRequestedByEmployee(dbOrQuery, {
  companyId,
  fromCandidateId,
  limit = FEEDBACK_LIST_CAP,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const fid = Number(fromCandidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(fid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const cap = Math.min(FEEDBACK_LIST_CAP, Math.max(1, Number(limit) || FEEDBACK_LIST_CAP));

  try {
    const res = await db.query(
      `SELECT f.id, f.company_id AS "companyId",
              f.subject_candidate_id AS "subjectCandidateId",
              f.from_candidate_id AS "fromCandidateId",
              f.to_candidate_id AS "toCandidateId",
              s.full_name AS "subjectName",
              fr.full_name AS "fromName",
              t.full_name AS "toName",
              f.prompt, f.token, f.status,
              f.response_text AS "responseText",
              f.answered_at AS "answeredAt",
              f.expires_at AS "expiresAt",
              f.created_at AS "createdAt"
       FROM feedback_requests f
       JOIN candidates s ON s.id = f.subject_candidate_id AND s.company_id = f.company_id
       JOIN candidates fr ON fr.id = f.from_candidate_id AND fr.company_id = f.company_id
       JOIN candidates t ON t.id = f.to_candidate_id AND t.company_id = f.company_id
       WHERE f.company_id = $1 AND f.from_candidate_id = $2
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $3`,
      [cid, fid, cap]
    );
    return { ok: true, items: res.rows.map(mapRequest) };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, items: [] };
    throw err;
  }
}

/** Inbox for the person asked to give feedback. */
export async function listFeedbackInbox(dbOrQuery, {
  companyId,
  toCandidateId,
  status = 'pending',
  limit = FEEDBACK_LIST_CAP,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const tid = Number(toCandidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(tid)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const cap = Math.min(FEEDBACK_LIST_CAP, Math.max(1, Number(limit) || FEEDBACK_LIST_CAP));
  const params = [cid, tid];
  let statusClause = '';
  if (status && status !== 'all') {
    params.push(status);
    statusClause = `AND f.status = $${params.length}`;
  }
  params.push(cap);

  try {
    const res = await db.query(
      `SELECT f.id, f.company_id AS "companyId",
              f.subject_candidate_id AS "subjectCandidateId",
              f.from_candidate_id AS "fromCandidateId",
              f.to_candidate_id AS "toCandidateId",
              s.full_name AS "subjectName",
              fr.full_name AS "fromName",
              t.full_name AS "toName",
              f.prompt, f.token, f.status,
              f.response_text AS "responseText",
              f.answered_at AS "answeredAt",
              f.expires_at AS "expiresAt",
              f.created_at AS "createdAt"
       FROM feedback_requests f
       JOIN candidates s ON s.id = f.subject_candidate_id AND s.company_id = f.company_id
       JOIN candidates fr ON fr.id = f.from_candidate_id AND fr.company_id = f.company_id
       JOIN candidates t ON t.id = f.to_candidate_id AND t.company_id = f.company_id
       WHERE f.company_id = $1 AND f.to_candidate_id = $2 ${statusClause}
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT $${params.length}`,
      params
    );
    return { ok: true, items: res.rows.map(mapRequest) };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, items: [] };
    throw err;
  }
}

export async function resolveFeedbackByToken(dbOrQuery, token) {
  const db = asDb(dbOrQuery || query);
  const tok = String(token || '').trim();
  if (tok.length < 24) return { ok: false, errorCode: ERR.INVALID_TOKEN };

  try {
    const res = await db.query(
      `SELECT f.id, f.company_id AS "companyId",
              f.subject_candidate_id AS "subjectCandidateId",
              f.from_candidate_id AS "fromCandidateId",
              f.to_candidate_id AS "toCandidateId",
              s.full_name AS "subjectName",
              fr.full_name AS "fromName",
              t.full_name AS "toName",
              f.prompt, f.token, f.status,
              f.response_text AS "responseText",
              f.answered_at AS "answeredAt",
              f.expires_at AS "expiresAt",
              f.created_at AS "createdAt"
       FROM feedback_requests f
       JOIN candidates s ON s.id = f.subject_candidate_id AND s.company_id = f.company_id
       JOIN candidates fr ON fr.id = f.from_candidate_id AND fr.company_id = f.company_id
       JOIN candidates t ON t.id = f.to_candidate_id AND t.company_id = f.company_id
       WHERE f.token = $1
       LIMIT 1`,
      [tok]
    );
    if (!res.rowCount) return { ok: false, errorCode: ERR.INVALID_TOKEN };
    const item = mapRequest(res.rows[0]);
    if (
      item.status === FEEDBACK_REQUEST_STATUS.PENDING &&
      item.expiresAt &&
      new Date(item.expiresAt).getTime() < Date.now()
    ) {
      await db.query(
        `UPDATE feedback_requests SET status = $1, updated_at = NOW()
         WHERE id = $2 AND status = $3`,
        [FEEDBACK_REQUEST_STATUS.EXPIRED, item.id, FEEDBACK_REQUEST_STATUS.PENDING]
      );
      item.status = FEEDBACK_REQUEST_STATUS.EXPIRED;
    }
    return { ok: true, request: item };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}

export async function answerFeedbackRequest(dbOrQuery, {
  token,
  responseText,
  answeredByCandidateId = null,
}) {
  const db = asDb(dbOrQuery || query);
  const resolved = await resolveFeedbackByToken(db, token);
  if (!resolved.ok) return resolved;
  const req = resolved.request;
  if (req.status !== FEEDBACK_REQUEST_STATUS.PENDING) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (
    answeredByCandidateId != null &&
    Number(answeredByCandidateId) !== Number(req.toCandidateId)
  ) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const text = String(responseText || '').trim();
  if (text.length < 5 || text.length > FEEDBACK_RESPONSE_MAX) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  try {
    const res = await db.query(
      `UPDATE feedback_requests
       SET response_text = $1,
           status = $2,
           answered_at = NOW(),
           updated_at = NOW()
       WHERE id = $3 AND status = $4
       RETURNING id, answered_at AS "answeredAt"`,
      [text, FEEDBACK_REQUEST_STATUS.ANSWERED, req.id, FEEDBACK_REQUEST_STATUS.PENDING]
    );
    if (!res.rowCount) return { ok: false, errorCode: ERR.INVALID_DATA };
    return {
      ok: true,
      id: Number(res.rows[0].id),
      answeredAt: res.rows[0].answeredAt,
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}
