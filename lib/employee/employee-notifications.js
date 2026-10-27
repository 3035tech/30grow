/**
 * Collaborator in-app notifications (candidate_notifications).
 */

import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';
import { mobilePushDestinationFor, sendMobileEmployeePush } from '../mobile/mobile-employee-push.js';
import {
  EMPLOYEE_NOTIF_TYPES,
  employeeNotificationCopySpec,
  employeeNotificationHref,
} from './employee-notification-catalog.js';

export {
  EMPLOYEE_NOTIF,
  EMPLOYEE_NOTIF_TYPES,
  employeeNotificationCopySpec,
  employeeNotificationHref,
} from './employee-notification-catalog.js';

const LIST_CAP = 40;

function queueMobilePush({ candidateId, companyId, destination, notificationId }) {
  if (destination === 'time_clock') return; // Transactional trigger owns durable point notifications.
  queueMicrotask(() => sendMobileEmployeePush(null, { candidateId, companyId, destination, notificationId })
    .catch(() => console.error('mobile employee push delivery failed')));
}

/**
 * Notify one collaborator (tenant-scoped).
 */
export async function notifyCandidate(dbOrQuery, opts) {
  // Allow notifyCandidate({ companyId, … }) — treat first arg as opts.
  let options = opts;
  let dbArg = dbOrQuery;
  if (
    options == null &&
    dbOrQuery &&
    typeof dbOrQuery === 'object' &&
    dbOrQuery.companyId != null &&
    dbOrQuery.type
  ) {
    options = dbOrQuery;
    dbArg = query;
  }
  const {
    companyId,
    candidateId,
    type,
    payload = {},
    entityType = null,
    entityId = null,
    dedupeKey = null,
  } = options || {};

  const db = asDb(dbArg || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand) || !type) return { inserted: 0 };
  if (!EMPLOYEE_NOTIF_TYPES.has(type)) {
    console.error('notifyCandidate: unknown type', type);
    return { inserted: 0 };
  }

  try {
    const own = await db.query(
      `SELECT 1 FROM candidates
       WHERE id = $1 AND company_id = $2
         AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       LIMIT 1`,
      [cand, cid]
    );
    if (own.rowCount === 0) return { inserted: 0 };

    if (dedupeKey) {
      const r = await db.query(
        `INSERT INTO candidate_notifications (
           company_id, recipient_candidate_id, type, payload,
           entity_type, entity_id, dedupe_key
         ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         ON CONFLICT (recipient_candidate_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)
         DO NOTHING
         RETURNING id`,
        [
          cid,
          cand,
          type,
          JSON.stringify(payload || {}),
          entityType,
          entityId,
          String(dedupeKey).slice(0, 200),
        ]
      );
      if (r.rowCount) queueMobilePush({ candidateId: cand, companyId: cid, notificationId: r.rows[0]?.id, destination: mobilePushDestinationFor(type) });
        return { inserted: r.rowCount };
    }

    const r = await db.query(
      `INSERT INTO candidate_notifications (
         company_id, recipient_candidate_id, type, payload,
         entity_type, entity_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id`,
      [cid, cand, type, JSON.stringify(payload || {}), entityType, entityId]
    );
    if (r.rowCount) queueMobilePush({ candidateId: cand, companyId: cid, notificationId: r.rows[0]?.id, destination: mobilePushDestinationFor(type) });
    return { inserted: r.rowCount };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { inserted: 0 };
    throw err;
  }
}

/**
 * Fan-out to many candidates in one company (single INSERT via unnest, capped).
 */
export async function notifyCandidates(dbOrQuery, opts) {
  let options = opts;
  let dbArg = dbOrQuery;
  if (
    options == null &&
    dbOrQuery &&
    typeof dbOrQuery === 'object' &&
    dbOrQuery.companyId != null &&
    dbOrQuery.type
  ) {
    options = dbOrQuery;
    dbArg = query;
  }
  const {
    companyId,
    candidateIds,
    type,
    payload = {},
    entityType = null,
    entityId = null,
    dedupeKeyPrefix = null,
  } = options || {};

  const ids = [...new Set((candidateIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].slice(
    0,
    200
  );
  if (!ids.length || !type) return { inserted: 0 };
  if (!EMPLOYEE_NOTIF_TYPES.has(type)) {
    console.error('notifyCandidates: unknown type', type);
    return { inserted: 0 };
  }

  const db = asDb(dbArg || query);
  const cid = Number(companyId);
  if (!Number.isFinite(cid)) return { inserted: 0 };

  try {
    const own = await db.query(
      `SELECT c.id
       FROM candidates c
       WHERE c.company_id = $1
         AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
         AND c.id = ANY($2::bigint[])`,
      [cid, ids]
    );
    const validIds = (own.rows || []).map((r) => Number(r.id));
    if (!validIds.length) return { inserted: 0 };

    const payloadJson = JSON.stringify(payload || {});
    const entId = entityId != null && Number.isFinite(Number(entityId)) ? Number(entityId) : null;
    const prefix = dedupeKeyPrefix ? String(dedupeKeyPrefix).slice(0, 180) : null;

    if (prefix) {
      const r = await db.query(
        `INSERT INTO candidate_notifications (
           company_id, recipient_candidate_id, type, payload,
           entity_type, entity_id, dedupe_key
         )
         SELECT $1, u.id, $2, $3::jsonb, $4, $5, LEFT($6 || ':' || u.id::text, 200)
         FROM unnest($7::bigint[]) AS u(id)
         ON CONFLICT (recipient_candidate_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)
         DO NOTHING
         RETURNING id, recipient_candidate_id AS "candidateId"`,
        [cid, type, payloadJson, entityType, entId, prefix, validIds]
      );
      for (const row of r.rows || []) queueMobilePush({ candidateId: Number(row.candidateId), companyId: cid, notificationId: row.id, destination: mobilePushDestinationFor(type) });
    return { inserted: r.rowCount };
    }

    const r = await db.query(
      `INSERT INTO candidate_notifications (
         company_id, recipient_candidate_id, type, payload,
         entity_type, entity_id
       )
       SELECT $1, u.id, $2, $3::jsonb, $4, $5
       FROM unnest($6::bigint[]) AS u(id)
       RETURNING id, recipient_candidate_id AS "candidateId"`,
      [cid, type, payloadJson, entityType, entId, validIds]
    );
    for (const row of r.rows || []) queueMobilePush({ candidateId: Number(row.candidateId), companyId: cid, notificationId: row.id, destination: mobilePushDestinationFor(type) });
    return { inserted: r.rowCount };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { inserted: 0 };
    throw err;
  }
}

export async function listCandidateNotifications(dbOrQuery, {
  companyId,
  candidateId,
  limit = 20,
  offset = 0,
  id = null,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const cap = Math.min(LIST_CAP, Math.max(1, Number(limit) || 20));
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  try {
    const itemsR = await db.query(
      `SELECT id, type, payload, entity_type AS "entityType", entity_id AS "entityId",
              read_at AS "readAt", created_at AS "createdAt"
       FROM candidate_notifications
       WHERE company_id = $1 AND recipient_candidate_id = $2
         ${id !== null ? 'AND id = $5' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [cid, cand, cap, Math.max(0, Math.trunc(Number(offset) || 0)), ...(id !== null ? [id] : [])]
    );
    const unreadR = await db.query(
      `SELECT COUNT(*) FILTER (WHERE read_at IS NULL)::int AS n, COUNT(*)::int AS total
       FROM candidate_notifications
       WHERE company_id = $1 AND recipient_candidate_id = $2`,
      [cid, cand]
    );
    const items = (itemsR.rows || []).map((row) => ({
      ...row,
      href: employeeNotificationHref(row.type, row.payload || {}),
      copy: employeeNotificationCopySpec(row.type, row.payload || {}),
    }));
    return {
      ok: true,
      items,
      unreadCount: unreadR.rows[0]?.n || 0,
      total: unreadR.rows[0]?.total || 0,
    };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return { ok: true, items: [], unreadCount: 0 };
    }
    throw err;
  }
}

export async function markCandidateNotificationRead(dbOrQuery, {
  companyId,
  candidateId,
  id = null,
  markAll = false,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  if (markAll) {
    await db.query(
      `UPDATE candidate_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE company_id = $1 AND recipient_candidate_id = $2 AND read_at IS NULL`,
      [cid, cand]
    );
  } else {
    const nid = Number(id);
    if (!Number.isFinite(nid)) return { ok: false, errorCode: ERR.INVALID_DATA };
    await db.query(
      `UPDATE candidate_notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND company_id = $2 AND recipient_candidate_id = $3 AND read_at IS NULL`,
      [nid, cid, cand]
    );
  }

  const unreadR = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM candidate_notifications
     WHERE company_id = $1 AND recipient_candidate_id = $2 AND read_at IS NULL`,
    [cid, cand]
  );
  return { ok: true, unreadCount: unreadR.rows[0]?.n || 0 };
}
