/**
 * Batched retention purge for in-app notification tables (manager and collaborator).
 * Read rows older than `readDays`, unread rows older than `unreadDays`.
 */
import { asDb } from './ae/as-db.js';

/** Tables with (id, read_at, created_at) and an index on created_at (027 / 146). */
export const NOTIFICATION_TABLE = Object.freeze({
  MANAGER: 'manager_notifications',
  CANDIDATE: 'candidate_notifications',
});

const ALLOWED_TABLES = new Set(Object.values(NOTIFICATION_TABLE));

export async function purgeOldNotifications(dbOrQuery, table, {
  readDays = 90,
  unreadDays = 180,
  batchSize = 500,
  maxBatches = 100,
} = {}) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`purgeOldNotifications: unsupported table ${table}`);
  const db = asDb(dbOrQuery);
  const rDays = Math.max(1, Number(readDays) || 90);
  const uDays = Math.max(rDays, Number(unreadDays) || 180);
  const bs = Math.min(5000, Math.max(1, Number(batchSize) || 500));
  const maxB = Math.min(2000, Math.max(1, Number(maxBatches) || 100));

  let deleted = 0;
  let batches = 0;
  let truncated = false;

  for (let i = 0; i < maxB; i += 1) {
    const res = await db.query(
      `WITH doomed AS (
         SELECT id FROM ${table}
         WHERE (
             (read_at IS NOT NULL AND created_at < NOW() - ($1::text || ' days')::interval)
             OR (read_at IS NULL AND created_at < NOW() - ($2::text || ' days')::interval)
           )
         ORDER BY created_at ASC
         LIMIT $3
       )
       DELETE FROM ${table} n
       USING doomed d
       WHERE n.id = d.id
       RETURNING n.id`,
      [String(rDays), String(uDays), bs]
    );
    batches += 1;
    deleted += res.rowCount || 0;
    if ((res.rowCount || 0) < bs) break;
    if (i === maxB - 1) truncated = true;
  }

  return { deleted, batches, batchSize: bs, readDays: rDays, unreadDays: uDays, truncated };
}
