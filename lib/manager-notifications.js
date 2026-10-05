/**
 * Notificações in-app genéricas para o time de RH da empresa.
 *
 * Isolamento multi-tenant:
 * - Fan-out só para users com o mesmo company_id do evento.
 * - Admin cross-tenant (company_id NULL) não recebe / não lista.
 * - Listagem amarra recipient_user_id + company_id.
 *
 * Time (vários gestores): cada um recebe a própria linha (inbox individual).
 * dedupe_key evita spam do mesmo evento (ex.: cron de prazo).
 */

import { DB_FANOUT_CONCURRENCY } from './concurrency.js';
import { asDb } from './ae/as-db.js';
import { NOTIFICATION_TABLE, purgeOldNotifications } from './notification-retention.js';
import { VACANCY_STATUS } from './domain-status.js';
import {
  NOTIF,
  NOTIF_TYPES,
  notificationCopySpec,
  notificationHref,
} from './manager-notification-catalog.js';

export {
  NOTIF,
  NOTIF_ENNEAGRAM,
  NOTIF_MOTIVATORS,
  notificationCopySpec,
  notificationHref,
} from './manager-notification-catalog.js';

async function loadUserCompanyId(db, userId) {
  const res = await db.query(
    `SELECT company_id AS "companyId"
     FROM users
     WHERE id = $1 AND deleted = FALSE AND active = TRUE
     LIMIT 1`,
    [userId]
  );
  if (!res.rowCount) return null;
  const cid = res.rows[0].companyId;
  return cid != null && Number.isFinite(Number(cid)) ? Number(cid) : null;
}

/**
 * Fan-out para todo o time RH da empresa (hr / direction / admin com company_id).
 */
export async function notifyCompanyManagers(dbOrQuery, {
  companyId,
  type,
  payload = {},
  entityType = null,
  entityId = null,
  dedupeKey = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0 || !type) return { inserted: 0 };
  if (!NOTIF_TYPES.has(type)) {
    console.error('notifyCompanyManagers: unknown type', type);
    return { inserted: 0 };
  }

  try {
    const candidateId = payload?.candidateId != null ? Number(payload.candidateId) : null;
    if (Number.isFinite(candidateId) && candidateId > 0) {
      const own = await db.query(
        `SELECT 1 FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
        [candidateId, cid]
      );
      if (own.rowCount === 0) {
        console.error('notifyCompanyManagers: candidate/company mismatch', { candidateId, cid });
        return { inserted: 0 };
      }
    }

    const vacancyId = payload?.vacancyId != null ? Number(payload.vacancyId) : null;
    if (Number.isFinite(vacancyId) && vacancyId > 0) {
      const own = await db.query(
        `SELECT 1 FROM vacancies WHERE id = $1 AND company_id = $2 AND deleted = FALSE LIMIT 1`,
        [vacancyId, cid]
      );
      if (own.rowCount === 0) {
        console.error('notifyCompanyManagers: vacancy/company mismatch', { vacancyId, cid });
        return { inserted: 0 };
      }
    }

    // Cap defensivo: empresa gigante não vira bigint[] gigante numa única query.
    // Fan-out para 1000+ gestores de uma vez indica erro de escopo, não caso legítimo.
    const RECIPIENT_CAP = 1000;
    const recipients = await db.query(
      `SELECT id
       FROM users
       WHERE company_id = $1
         AND deleted = FALSE
         AND active = TRUE
         AND role IN ('hr', 'direction', 'admin')
       ORDER BY id
       LIMIT $2`,
      [cid, RECIPIENT_CAP]
    );
    if (!recipients.rowCount) return { inserted: 0 };

    const payloadJson = JSON.stringify(payload || {});
    const entId = entityId != null && Number.isFinite(Number(entityId)) ? Number(entityId) : null;
    const key = dedupeKey ? String(dedupeKey).slice(0, 200) : null;
    const recipientIds = recipients.rows.map((r) => r.id);

    if (key) {
      const ins = await db.query(
        `INSERT INTO manager_notifications (
           company_id, recipient_user_id, type, payload, entity_type, entity_id, dedupe_key
         )
         SELECT $1, u.id, $2, $3::jsonb, $4, $5, $6
         FROM unnest($7::bigint[]) AS u(id)
         ON CONFLICT (recipient_user_id, dedupe_key) WHERE (dedupe_key IS NOT NULL)
         DO NOTHING
         RETURNING id`,
        [cid, type, payloadJson, entityType, entId, key, recipientIds]
      );
      return { inserted: ins.rowCount, recipients: recipients.rowCount };
    }

    const ins = await db.query(
      `INSERT INTO manager_notifications (
         company_id, recipient_user_id, type, payload, entity_type, entity_id, dedupe_key
       )
       SELECT $1, u.id, $2, $3::jsonb, $4, $5, NULL
       FROM unnest($6::bigint[]) AS u(id)
       RETURNING id`,
      [cid, type, payloadJson, entityType, entId, recipientIds]
    );
    return { inserted: ins.rowCount, recipients: recipients.rowCount };
  } catch (err) {
    console.error('notifyCompanyManagers failed:', err?.message || err);
    return { inserted: 0, error: true };
  }
}

export async function listNotificationsForUser(dbOrQuery, userId, { limit = 30, unreadOnly = false } = {}) {
  const db = asDb(dbOrQuery);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return { items: [], unreadCount: 0 };

  const companyId = await loadUserCompanyId(db, uid);
  if (companyId == null) return { items: [], unreadCount: 0 };

  const lim = Math.min(50, Math.max(1, Number(limit) || 30));
  const where = ['recipient_user_id = $1', 'company_id = $2'];
  const params = [uid, companyId];
  if (unreadOnly) where.push('read_at IS NULL');
  params.push(lim);

  const items = await db.query(
    `SELECT id, company_id AS "companyId", type, payload,
            entity_type AS "entityType", entity_id AS "entityId",
            read_at AS "readAt", created_at AS "createdAt"
     FROM manager_notifications
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const { unreadCount } = await countUnreadForCompany(db, uid, companyId);
  return { items: items.rows, unreadCount };
}

async function countUnreadForCompany(db, uid, companyId) {
  const r = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM manager_notifications
         WHERE recipient_user_id = $1 AND company_id = $2 AND read_at IS NULL) AS n,
       (SELECT created_at FROM manager_notifications
         WHERE recipient_user_id = $1 AND company_id = $2
         ORDER BY created_at DESC LIMIT 1) AS "latestAt"`,
    [uid, companyId]
  );
  return { unreadCount: r.rows[0]?.n ?? 0, latestAt: r.rows[0]?.latestAt ?? null };
}

/**
 * Badge polling: unread count + newest notification time (lets the client refetch
 * the list only when something changed). Two index-backed lookups, no row payload.
 */
export async function countUnreadNotificationsForUser(dbOrQuery, userId) {
  const db = asDb(dbOrQuery);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return { unreadCount: 0, latestAt: null };
  const companyId = await loadUserCompanyId(db, uid);
  if (companyId == null) return { unreadCount: 0, latestAt: null };
  return countUnreadForCompany(db, uid, companyId);
}

export async function markNotificationRead(dbOrQuery, userId, notificationId) {
  const db = asDb(dbOrQuery);
  const uid = Number(userId);
  const nid = Number(notificationId);
  if (!Number.isFinite(uid) || !Number.isFinite(nid)) return { ok: false };

  const companyId = await loadUserCompanyId(db, uid);
  if (companyId == null) return { ok: false };

  const res = await db.query(
    `UPDATE manager_notifications
     SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1
       AND recipient_user_id = $2
       AND company_id = $3
     RETURNING id, read_at AS "readAt"`,
    [nid, uid, companyId]
  );
  return { ok: res.rowCount > 0, row: res.rows[0] || null };
}

export async function markAllNotificationsRead(dbOrQuery, userId) {
  const db = asDb(dbOrQuery);
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return { ok: false, updated: 0 };

  const companyId = await loadUserCompanyId(db, uid);
  if (companyId == null) return { ok: false, updated: 0 };

  const res = await db.query(
    `UPDATE manager_notifications
     SET read_at = NOW()
     WHERE recipient_user_id = $1
       AND company_id = $2
       AND read_at IS NULL`,
    [uid, companyId]
  );
  return { ok: true, updated: res.rowCount || 0 };
}

/**
 * Cron: vagas abertas com target_date nos próximos withinDays dias.
 */
export async function notifyApproachingVacancyDeadlines(dbOrQuery, { withinDays = 7 } = {}) {
  const db = asDb(dbOrQuery);
  const days = Math.min(30, Math.max(1, Number(withinDays) || 7));

  const due = await db.query(
    `SELECT v.id, v.company_id AS "companyId", v.title, v.target_date AS "targetDate"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id AND c.deleted = FALSE
     WHERE v.deleted = FALSE
       AND v.status = '${VACANCY_STATUS.OPEN}'
       AND v.target_date IS NOT NULL
       AND v.target_date >= CURRENT_DATE
       AND v.target_date <= (CURRENT_DATE + ($1::int * INTERVAL '1 day'))
     ORDER BY v.target_date ASC
     LIMIT 200`,
    [days]
  );

  let inserted = 0;
  // Parallel chunks — each vacancy has distinct dedupeKey/payload; unnest would need per-row payloads.
  const rows = due.rows || [];
  const CHUNK = DB_FANOUT_CONCURRENCY;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const results = await Promise.all(
      slice.map(async (row) => {
        const target = row.targetDate ? String(row.targetDate).slice(0, 10) : null;
        return notifyCompanyManagers(db, {
          companyId: row.companyId,
          type: NOTIF.VACANCY_DEADLINE_APPROACHING,
          entityType: 'vacancy',
          entityId: row.id,
          dedupeKey: `vacancy_deadline:${row.id}:${target}`,
          payload: {
            vacancyId: row.id,
            vacancyTitle: row.title,
            targetDate: target,
          },
        });
      })
    );
    for (const r of results) inserted += r.inserted || 0;
  }
  return { vacancies: due.rowCount, inserted };
}

/**
 * Cron / retention: delete old manager notifications in batches.
 * Default: read notifications older than `readDays`; unread older than `unreadDays`.
 */
export async function purgeOldManagerNotifications(dbOrQuery, opts = {}) {
  return purgeOldNotifications(dbOrQuery, NOTIFICATION_TABLE.MANAGER, opts);
}
