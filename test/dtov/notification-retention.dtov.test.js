/**
 * DTOV: manager badge count endpoint helper + retention purge for manager and
 * collaborator inboxes (old read/unread removed, recent kept, tenant untouched).
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  purgeOldManagerNotifications,
} from '../../lib/manager-notifications.js';
import { NOTIFICATION_TABLE, purgeOldNotifications } from '../../lib/notification-retention.js';

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing: run dtov:reset');
  const companyId = Number(co.rows[0].id);
  const hr = await query(
    `SELECT id FROM users WHERE company_id = $1 AND email = 'hr@todos-os-dados.demo' AND deleted = FALSE LIMIT 1`,
    [companyId]
  );
  const userId = Number(hr.rows[0].id);
  const emp = await query(
    `SELECT id FROM candidates WHERE company_id = $1 AND email = 'colaborador@todos-os-dados.demo' LIMIT 1`,
    [companyId]
  );
  const candidateId = Number(emp.rows[0].id);

  const ins = (age, read) => query(
    `INSERT INTO manager_notifications (company_id, recipient_user_id, type, payload, read_at, created_at)
     VALUES ($1, $2, 'enneagram_completed', '{"dtov":true}'::jsonb,
             CASE WHEN $4 THEN NOW() - ($3::int * INTERVAL '1 day') END, NOW() - ($3::int * INTERVAL '1 day'))
     RETURNING id`,
    [companyId, userId, age, read]
  );
  const oldRead = (await ins(120, true)).rows[0].id;
  const oldUnread = (await ins(200, false)).rows[0].id;
  const midUnread = (await ins(120, false)).rows[0].id;
  const fresh = (await ins(0, false)).rows[0].id;

  const count = await countUnreadNotificationsForUser({ query }, userId);
  const list = await listNotificationsForUser({ query }, userId, { limit: 5 });
  assert.equal(count.unreadCount, list.unreadCount, 'count endpoint matches list badge');
  assert.ok(count.unreadCount >= 3);
  assert.ok(count.latestAt, 'latestAt present');
  assert.equal(new Date(count.latestAt).getTime(), new Date(list.items[0].createdAt).getTime());
  const none = await countUnreadNotificationsForUser({ query }, 'abc');
  assert.deepEqual(none, { unreadCount: 0, latestAt: null });

  const mgr = await purgeOldManagerNotifications({ query });
  assert.ok(mgr.deleted >= 2, JSON.stringify(mgr));
  const left = await query(`SELECT id FROM manager_notifications WHERE id = ANY($1::bigint[])`, [[oldRead, oldUnread, midUnread, fresh]]);
  const kept = new Set(left.rows.map((r) => String(r.id)));
  assert.ok(!kept.has(String(oldRead)), 'read > 90 days purged');
  assert.ok(!kept.has(String(oldUnread)), 'unread > 180 days purged');
  assert.ok(kept.has(String(midUnread)), 'unread 120 days kept');
  assert.ok(kept.has(String(fresh)), 'fresh kept');

  const cIns = (age, read) => query(
    `INSERT INTO candidate_notifications (company_id, recipient_candidate_id, type, payload, read_at, created_at)
     VALUES ($1, $2, 'dtov', '{}'::jsonb,
             CASE WHEN $4 THEN NOW() - ($3::int * INTERVAL '1 day') END, NOW() - ($3::int * INTERVAL '1 day'))
     RETURNING id`,
    [companyId, candidateId, age, read]
  );
  const cOld = (await cIns(100, true)).rows[0].id;
  const cFresh = (await cIns(1, true)).rows[0].id;
  const cand = await purgeOldNotifications({ query }, NOTIFICATION_TABLE.CANDIDATE, { batchSize: 1, maxBatches: 50 });
  assert.ok(cand.deleted >= 1, JSON.stringify(cand));
  const cLeft = await query(`SELECT id FROM candidate_notifications WHERE id = ANY($1::bigint[])`, [[cOld, cFresh]]);
  assert.deepEqual(cLeft.rows.map((r) => String(r.id)), [String(cFresh)]);

  await query(`DELETE FROM manager_notifications WHERE id = ANY($1::bigint[])`, [[midUnread, fresh]]);
  await query(`DELETE FROM candidate_notifications WHERE id = $1`, [cFresh]);
  console.log('notification-retention.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
