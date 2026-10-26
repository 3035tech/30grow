/**
 * B-3004 — Light OKRs (company → team group → person). Not a full OKR suite.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { OKR_OBJECTIVE_LEVEL, OKR_OBJECTIVE_LEVELS } from '../domain-status.js';

export const OKR_OBJECTIVE_CAP = 40;
export const OKR_KR_CAP_PER_OBJECTIVE = 8;

function normalizeLevel(raw) {
  const s = String(raw || '').toLowerCase();
  return OKR_OBJECTIVE_LEVELS.includes(s) ? s : OKR_OBJECTIVE_LEVEL.COMPANY;
}

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function mapObjective(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    parentId: row.parentId != null ? Number(row.parentId) : null,
    level: row.level,
    title: row.title,
    description: row.description || '',
    teamGroupId: row.teamGroupId != null ? Number(row.teamGroupId) : null,
    candidateId: row.candidateId != null ? Number(row.candidateId) : null,
    periodStart: dateOrNull(row.periodStart),
    periodEnd: dateOrNull(row.periodEnd),
    createdByUserId: row.createdByUserId != null ? Number(row.createdByUserId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    keyResults: Array.isArray(row.keyResults) ? row.keyResults : undefined,
  };
}

function mapKr(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    objectiveId: Number(row.objectiveId),
    title: row.title,
    unit: row.unit || '',
    targetValue: Number(row.targetValue) || 0,
    currentValue: Number(row.currentValue) || 0,
    performanceGoalId:
      row.performanceGoalId != null ? Number(row.performanceGoalId) : null,
    sortOrder: Number(row.sortOrder) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listOkrTree(dbOrQuery, { companyId, limit = OKR_OBJECTIVE_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  const cap = Math.min(OKR_OBJECTIVE_CAP, Math.max(1, Number(limit) || OKR_OBJECTIVE_CAP));

  const objs = await db.query(
    `SELECT o.id, o.company_id AS "companyId", o.parent_id AS "parentId", o.level,
            o.title, o.description, o.team_group_id AS "teamGroupId",
            o.candidate_id AS "candidateId",
            o.period_start AS "periodStart", o.period_end AS "periodEnd",
            o.created_by_user_id AS "createdByUserId",
            o.created_at AS "createdAt", o.updated_at AS "updatedAt",
            tg.name AS "teamGroupName",
            c.full_name AS "candidateName",
            parent.title AS "parentTitle"
     FROM okr_objectives o
     LEFT JOIN team_groups tg
       ON tg.id = o.team_group_id AND tg.company_id = o.company_id AND tg.deleted = FALSE
     LEFT JOIN candidates c
       ON c.id = o.candidate_id AND c.company_id = o.company_id
     LEFT JOIN okr_objectives parent
       ON parent.id = o.parent_id AND parent.company_id = o.company_id
     WHERE o.company_id = $1 AND o.area_id IS NULL
     ORDER BY
       CASE o.level WHEN 'company' THEN 0 WHEN 'team' THEN 1 ELSE 2 END,
       o.updated_at DESC, o.id DESC
     LIMIT $2`,
    [cid, cap]
  );
  const objectives = (objs.rows || []).map((row) => ({
    ...mapObjective(row),
    teamGroupName: row.teamGroupName || null,
    candidateName: row.candidateName || null,
    parentTitle: row.parentTitle || null,
  }));
  const ids = objectives.map((o) => o.id);
  if (!ids.length) return { ok: true, objectives: [], cap };

  const krs = await db.query(
    `SELECT k.id, k.company_id AS "companyId", k.objective_id AS "objectiveId",
            k.title, k.unit, k.target_value AS "targetValue", k.current_value AS "currentValue",
            k.performance_goal_id AS "performanceGoalId", k.sort_order AS "sortOrder",
            k.created_at AS "createdAt", k.updated_at AS "updatedAt"
     FROM okr_key_results k
     WHERE k.company_id = $1 AND k.objective_id = ANY($2::bigint[])
     ORDER BY k.sort_order ASC, k.id ASC`,
    [cid, ids]
  );
  const byObj = new Map(ids.map((id) => [id, []]));
  for (const row of krs.rows || []) {
    const kr = mapKr(row);
    const list = byObj.get(kr.objectiveId);
    if (list && list.length < OKR_KR_CAP_PER_OBJECTIVE) list.push(kr);
  }
  return {
    ok: true,
    objectives: objectives.map((o) => ({ ...o, keyResults: byObj.get(o.id) || [] })),
    cap,
  };
}

export async function createOkrObjective(dbOrQuery, {
  companyId,
  title,
  description = '',
  level = OKR_OBJECTIVE_LEVEL.COMPANY,
  parentId = null,
  teamGroupId = null,
  candidateId = null,
  periodStart = null,
  periodEnd = null,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const safeTitle = String(title || '').trim().slice(0, 300);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!safeTitle) return { ok: false, errorCode: ERR.INVALID_DATA };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_objectives WHERE company_id = $1`,
    [cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_OBJECTIVE_CAP) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const lvl = normalizeLevel(level);
  const res = await db.query(
    `INSERT INTO okr_objectives (
       company_id, parent_id, level, title, description,
       team_group_id, candidate_id, period_start, period_end, created_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10)
     RETURNING id, company_id AS "companyId", parent_id AS "parentId", level,
               title, description, team_group_id AS "teamGroupId",
               candidate_id AS "candidateId",
               period_start AS "periodStart", period_end AS "periodEnd",
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      cid,
      parentId ? Number(parentId) : null,
      lvl,
      safeTitle,
      String(description || '').trim().slice(0, 2000),
      teamGroupId ? Number(teamGroupId) : null,
      candidateId ? Number(candidateId) : null,
      dateOrNull(periodStart),
      dateOrNull(periodEnd),
      createdByUserId || null,
    ]
  );
  return { ok: true, objective: { ...mapObjective(res.rows[0]), keyResults: [] } };
}

export async function createOkrKeyResult(dbOrQuery, {
  companyId,
  objectiveId,
  title,
  unit = '',
  targetValue = 0,
  currentValue = 0,
  performanceGoalId = null,
  sortOrder = 0,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const oid = Number(objectiveId);
  const safeTitle = String(title || '').trim().slice(0, 300);
  if (!Number.isFinite(cid) || !Number.isFinite(oid) || !safeTitle) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const owner = await db.query(
    `SELECT id FROM okr_objectives WHERE id = $1 AND company_id = $2 AND area_id IS NULL LIMIT 1`,
    [oid, cid]
  );
  if (owner.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_key_results WHERE objective_id = $1 AND company_id = $2`,
    [oid, cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_KR_CAP_PER_OBJECTIVE) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  let goalId = performanceGoalId ? Number(performanceGoalId) : null;
  if (goalId) {
    const g = await db.query(
      `SELECT id FROM performance_goals WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [goalId, cid]
    );
    if (g.rowCount === 0) goalId = null;
  }

  const res = await db.query(
    `INSERT INTO okr_key_results (
       company_id, objective_id, title, unit, target_value, current_value,
       performance_goal_id, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, company_id AS "companyId", objective_id AS "objectiveId",
               title, unit, target_value AS "targetValue", current_value AS "currentValue",
               performance_goal_id AS "performanceGoalId", sort_order AS "sortOrder",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      cid,
      oid,
      safeTitle,
      String(unit || '').trim().slice(0, 40),
      Number(targetValue) || 0,
      Number(currentValue) || 0,
      goalId,
      Number(sortOrder) || 0,
    ]
  );
  return { ok: true, keyResult: mapKr(res.rows[0]) };
}

export async function updateOkrKeyResultProgress(dbOrQuery, {
  companyId,
  keyResultId,
  currentValue,
  targetValue,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const kid = Number(keyResultId);
  if (!Number.isFinite(cid) || !Number.isFinite(kid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const sets = ['updated_at = NOW()'];
  const params = [cid, kid];
  let n = 3;
  if (currentValue !== undefined) {
    sets.push(`current_value = $${n++}`);
    params.push(Number(currentValue) || 0);
  }
  if (targetValue !== undefined) {
    sets.push(`target_value = $${n++}`);
    params.push(Number(targetValue) || 0);
  }
  if (sets.length === 1) return { ok: false, errorCode: ERR.INVALID_DATA };

  const res = await db.query(
    `UPDATE okr_key_results SET ${sets.join(', ')}
     WHERE id = $2 AND company_id = $1 AND start_value IS NULL
     RETURNING id, company_id AS "companyId", objective_id AS "objectiveId",
               title, unit, target_value AS "targetValue", current_value AS "currentValue",
               performance_goal_id AS "performanceGoalId", sort_order AS "sortOrder",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, keyResult: mapKr(res.rows[0]) };
}

export async function deleteOkrObjective(dbOrQuery, { companyId, objectiveId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const oid = Number(objectiveId);
  const res = await db.query(
    `DELETE FROM okr_objectives WHERE id = $2 AND company_id = $1 AND area_id IS NULL RETURNING id`,
    [cid, oid]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}
