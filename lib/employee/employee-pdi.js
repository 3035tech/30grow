/**
 * Collaborator self-serve PDI item status (owned plans only).
 */

import { asDb } from '../ae/as-db.js';
import { query } from '../db.js';
import { ERR } from '../api-error-codes.js';
import {
  EMPLOYMENT_STATUS,
  DEVELOPMENT_PLAN_ITEM_STATUS,
} from '../domain-status.js';
import { updateDevelopmentPlanItem } from '../people/development-plans.js';

const ALLOWED = new Set([
  DEVELOPMENT_PLAN_ITEM_STATUS.TODO,
  DEVELOPMENT_PLAN_ITEM_STATUS.DOING,
  DEVELOPMENT_PLAN_ITEM_STATUS.DONE,
]);

/**
 * Mark / unmark a PDI item for the logged-in employee.
 */
export async function updateEmployeePdiItemStatus(dbOrQuery, {
  companyId,
  candidateId,
  itemId,
  status,
}) {
  const db = asDb(dbOrQuery || query);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const iid = Number(itemId);
  const next = String(status || '').trim();
  if (!Number.isFinite(cid) || !Number.isFinite(cand) || !Number.isFinite(iid)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  if (!ALLOWED.has(next)) return { ok: false, errorCode: ERR.INVALID_DATA };

  const emp = await db.query(
    `SELECT 1 FROM candidates
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (emp.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };

  const owned = await db.query(
    `SELECT i.id, i.plan_id AS "planId", p.title AS "planTitle", i.title AS "itemTitle"
     FROM development_plan_items i
     JOIN development_plans p ON p.id = i.plan_id AND p.company_id = i.company_id
     WHERE i.id = $1 AND i.company_id = $2 AND p.candidate_id = $3
     LIMIT 1`,
    [iid, cid, cand]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const upd = await updateDevelopmentPlanItem(db, {
    companyId: cid,
    planId: owned.rows[0].planId,
    itemId: iid,
    status: next,
  });
  if (!upd.ok) return upd;
  return {
    ok: true,
    item: upd.item,
    planId: owned.rows[0].planId,
    planTitle: owned.rows[0].planTitle,
  };
}
