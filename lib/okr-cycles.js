/**
 * OKR phase 1: cycles → areas → activities with % progress and deadline urgency.
 * Light OKR tree (okr_objectives) remains in lib/okr.js for legacy API.
 */

import { asDb } from './ae/as-db.js';
import { withTransaction } from './db.js';
import { ERR } from './api-error-codes.js';
import {
  EMPLOYMENT_STATUS,
  OKR_CYCLE_STATUS,
  OKR_CYCLE_STATUSES,
  OKR_WEIGHT_DEFAULT,
  OKR_WEIGHT_MAX,
  OKR_WEIGHT_MIN,
} from './domain-status.js';
import { toDateOnlyIso } from './format-display-date.js';

export { OKR_WEIGHT_DEFAULT, OKR_WEIGHT_MAX, OKR_WEIGHT_MIN };

export const OKR_CYCLE_CAP = 12;
export const OKR_AREA_CAP_PER_CYCLE = 24;
export const OKR_ACTIVITY_CAP_PER_AREA = 40;
export const OKR_ASSIGNEE_CAP_PER_ACTIVITY = 20;
export const OKR_CHECKIN_CAP_PER_ACTIVITY = 40;
export const OKR_CHECKIN_NOTE_MAX = 500;

function dateOrNull(raw) {
  return toDateOnlyIso(raw);
}

function clampPct(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/** Relative weight 0–10 (default 5). 0 is skipped in rollup. */
export function clampWeight(n) {
  if (n == null || n === '') return OKR_WEIGHT_DEFAULT;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return OKR_WEIGHT_DEFAULT;
  if (v < OKR_WEIGHT_MIN) return OKR_WEIGHT_MIN;
  if (v > OKR_WEIGHT_MAX) return OKR_WEIGHT_MAX;
  return v;
}

/** Mean of 0–100 values; empty → null. */
export function meanProgressPct(values) {
  const nums = (values || [])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + Math.min(100, Math.max(0, b)), 0);
  return Math.round(sum / nums.length);
}

/**
 * Weighted mean of progress (B-3004 deepen: pesos).
 * @param {Array<{ progressPct?: number, weight?: number }>} items
 */
export function weightedProgressPct(items) {
  let wSum = 0;
  let pSum = 0;
  for (const it of items || []) {
    if (it == null) continue;
    const w = clampWeight(it.weight == null ? OKR_WEIGHT_DEFAULT : it.weight);
    if (w <= 0) continue;
    const p = clampPct(it.progressPct);
    wSum += w;
    pSum += p * w;
  }
  if (wSum <= 0) return null;
  return Math.round(pSum / wSum);
}

/**
 * Urgency for an activity near deadline with low progress.
 * @returns {'done'|'overdue'|'critical'|'warn'|'none'}
 */
export function activityUrgency(activity, { today = null } = {}) {
  const pct = clampPct(activity?.progressPct);
  if (pct >= 100) return 'done';
  const deadline = dateOrNull(activity?.deadline);
  if (!deadline) return 'none';
  const todayStr = dateOrNull(today) || new Date().toISOString().slice(0, 10);
  const t0 = Date.parse(`${todayStr}T12:00:00Z`);
  const t1 = Date.parse(`${deadline}T12:00:00Z`);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 'none';
  const daysLeft = Math.ceil((t1 - t0) / 86400000);
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 14 && pct < 50) return 'critical';
  if (daysLeft <= 30 && pct < 70) return 'warn';
  return 'none';
}

function mapCycle(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    title: row.title,
    startsOn: dateOrNull(row.startsOn),
    endsOn: dateOrNull(row.endsOn),
    status: row.status === OKR_CYCLE_STATUS.CLOSED ? OKR_CYCLE_STATUS.CLOSED : OKR_CYCLE_STATUS.ACTIVE,
    createdByUserId: row.createdByUserId != null ? Number(row.createdByUserId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapArea(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    cycleId: Number(row.cycleId),
    title: row.title,
    sortOrder: Number(row.sortOrder) || 0,
    teamGroupId: row.teamGroupId != null ? Number(row.teamGroupId) : null,
    teamGroupName: row.teamGroupName || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapActivity(row) {
  const progressPct = clampPct(row.progressPct);
  const deadline = dateOrNull(row.deadline);
  const act = {
    id: Number(row.id),
    companyId: Number(row.companyId),
    areaId: Number(row.areaId),
    title: row.title,
    progressPct,
    weight: clampWeight(row.weight == null ? OKR_WEIGHT_DEFAULT : row.weight),
    deadline,
    sortOrder: Number(row.sortOrder) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    checkinCount: row.checkinCount != null ? Number(row.checkinCount) || 0 : 0,
    lastCheckinAt: row.lastCheckinAt || null,
  };
  act.urgency = activityUrgency(act);
  act.assignees = Array.isArray(row.assignees) ? row.assignees : [];
  return act;
}

function mapCheckin(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.companyId),
    activityId: Number(row.activityId),
    progressPct: clampPct(row.progressPct),
    note: row.note || '',
    createdByUserId: row.createdByUserId != null ? Number(row.createdByUserId) : null,
    createdByCandidateId:
      row.createdByCandidateId != null ? Number(row.createdByCandidateId) : null,
    createdByName: row.createdByName || null,
    createdAt: row.createdAt,
  };
}

function enrichAreas(areas, activitiesByArea) {
  return (areas || []).map((area) => {
    const activities = activitiesByArea.get(area.id) || [];
    const progressPct = weightedProgressPct(activities);
    return { ...area, activities, progressPct, activityCount: activities.length };
  });
}

function enrichCycle(cycle, areas) {
  const allActs = (areas || []).flatMap((a) => a.activities || []);
  const progressPct =
    allActs.length > 0
      ? weightedProgressPct(allActs)
      : meanProgressPct((areas || []).map((a) => a.progressPct).filter((p) => p != null));
  const activityCount = (areas || []).reduce((n, a) => n + (a.activityCount || 0), 0);
  return {
    ...cycle,
    areas: areas || [],
    progressPct,
    areaCount: (areas || []).length,
    activityCount,
  };
}

/**
 * @param {{ companyId: number, limit?: number, withActivityDetails?: boolean }} opts
 * `withActivityDetails: false` skips assignees and check-in stats (the KR hierarchy
 * only shows legacy activities as title + %).
 */
export async function listOkrCycles(dbOrQuery, { companyId, limit = OKR_CYCLE_CAP, withActivityDetails = true } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  const cap = Math.min(OKR_CYCLE_CAP, Math.max(1, Number(limit) || OKR_CYCLE_CAP));

  const cyclesRes = await db.query(
    `SELECT id, company_id AS "companyId", title,
            starts_on AS "startsOn", ends_on AS "endsOn", status,
            created_by_user_id AS "createdByUserId",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM okr_cycles
     WHERE company_id = $1
     ORDER BY starts_on DESC, id DESC
     LIMIT $2`,
    [cid, cap]
  );
  const cycles = (cyclesRes.rows || []).map(mapCycle);
  if (!cycles.length) return { ok: true, cycles: [], cap };

  const cycleIds = cycles.map((c) => c.id);
  const areasRes = await db.query(
    `SELECT a.id, a.company_id AS "companyId", a.cycle_id AS "cycleId", a.title,
            a.sort_order AS "sortOrder", a.team_group_id AS "teamGroupId",
            a.created_at AS "createdAt", a.updated_at AS "updatedAt",
            tg.name AS "teamGroupName"
     FROM (
       SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.cycle_id ORDER BY a.sort_order, a.id) AS rn
       FROM okr_areas a
       WHERE a.company_id = $1 AND a.cycle_id = ANY($2::bigint[])
     ) a
     LEFT JOIN team_groups tg
       ON tg.id = a.team_group_id AND tg.company_id = a.company_id AND tg.deleted = FALSE
     WHERE a.rn <= $3
     ORDER BY a.sort_order ASC, a.id ASC`,
    [cid, cycleIds, OKR_AREA_CAP_PER_CYCLE]
  );
  const areas = (areasRes.rows || []).map(mapArea);
  const areaIds = areas.map((a) => a.id);

  const cappedActivities = `
    SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.area_id ORDER BY a.sort_order, a.id) AS rn
    FROM okr_activities a
    WHERE a.company_id = $1 AND a.area_id = ANY($2::bigint[])`;
  const plainActivities = () => db.query(
    `SELECT id, company_id AS "companyId", area_id AS "areaId", title,
            progress_pct AS "progressPct", weight, deadline, sort_order AS "sortOrder",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM (${cappedActivities}) a
     WHERE a.rn <= $3
     ORDER BY a.sort_order ASC, a.id ASC`,
    [cid, areaIds, OKR_ACTIVITY_CAP_PER_AREA]
  );

  let activities = [];
  if (areaIds.length) {
    try {
      const actRes = withActivityDetails
        ? await db.query(
          `SELECT a.id, a.company_id AS "companyId", a.area_id AS "areaId", a.title,
                  a.progress_pct AS "progressPct", a.weight, a.deadline,
                  a.sort_order AS "sortOrder",
                  a.created_at AS "createdAt", a.updated_at AS "updatedAt",
                  COALESCE(ck.cnt, 0)::int AS "checkinCount",
                  ck.last_at AS "lastCheckinAt"
           FROM (${cappedActivities}) a
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS cnt, MAX(created_at) AS last_at
             FROM okr_activity_checkins c
             WHERE c.activity_id = a.id AND c.company_id = a.company_id
           ) ck ON TRUE
           WHERE a.rn <= $3
           ORDER BY a.sort_order ASC, a.id ASC`,
          [cid, areaIds, OKR_ACTIVITY_CAP_PER_AREA]
        )
        : await plainActivities();
      activities = (actRes.rows || []).map(mapActivity);
    } catch (err) {
      if (err?.code !== '42P01' || !withActivityDetails) throw err;
      activities = ((await plainActivities()).rows || []).map(mapActivity);
    }
  }

  const activityIds = activities.map((a) => a.id);
  const assigneesByActivity = new Map(activityIds.map((id) => [id, []]));
  if (withActivityDetails && activityIds.length) {
    try {
      const asg = await db.query(
        `SELECT "activityId", "candidateId", "fullName", email
         FROM (
           SELECT a.activity_id AS "activityId", a.candidate_id AS "candidateId",
                  c.full_name AS "fullName", c.email,
                  ROW_NUMBER() OVER (PARTITION BY a.activity_id ORDER BY c.full_name, a.candidate_id) AS rn
           FROM okr_activity_assignees a
           JOIN candidates c
             ON c.id = a.candidate_id AND c.company_id = a.company_id
           WHERE a.company_id = $1 AND a.activity_id = ANY($2::bigint[])
         ) s
         WHERE s.rn <= $3
         ORDER BY "fullName" ASC, "candidateId" ASC`,
        [cid, activityIds, OKR_ASSIGNEE_CAP_PER_ACTIVITY]
      );
      for (const row of asg.rows || []) {
        assigneesByActivity.get(Number(row.activityId))?.push({
          candidateId: Number(row.candidateId),
          fullName: row.fullName || '',
          email: row.email || '',
        });
      }
    } catch (err) {
      if (err?.code !== '42P01') throw err;
    }
  }

  const activitiesByArea = new Map(areaIds.map((id) => [id, []]));
  for (const act of activities) {
    if (withActivityDetails) {
      act.assignees = assigneesByActivity.get(act.id) || [];
    } else {
      // Not loaded in lean mode: omit rather than report empty owners / zero check-ins.
      delete act.assignees;
      delete act.checkinCount;
      delete act.lastCheckinAt;
    }
    activitiesByArea.get(act.areaId)?.push(act);
  }

  const areasByCycle = new Map(cycleIds.map((id) => [id, []]));
  for (const area of enrichAreas(areas, activitiesByArea)) {
    areasByCycle.get(area.cycleId)?.push(area);
  }

  return {
    ok: true,
    cycles: cycles.map((c) => enrichCycle(c, areasByCycle.get(c.id) || [])),
    cap,
  };
}

export async function createOkrCycle(dbOrQuery, {
  companyId,
  title,
  startsOn,
  endsOn,
  status = OKR_CYCLE_STATUS.ACTIVE,
  createdByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const safeTitle = String(title || '').trim().slice(0, 200);
  const start = dateOrNull(startsOn);
  const end = dateOrNull(endsOn);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  if (!safeTitle || !start || !end) return { ok: false, errorCode: ERR.INVALID_DATA };
  if (end < start) return { ok: false, errorCode: ERR.INVALID_DATA };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_cycles WHERE company_id = $1`,
    [cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_CYCLE_CAP) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const st = OKR_CYCLE_STATUSES.includes(status) ? status : OKR_CYCLE_STATUS.ACTIVE;
  const res = await db.query(
    `INSERT INTO okr_cycles (
       company_id, title, starts_on, ends_on, status, created_by_user_id
     ) VALUES ($1, $2, $3::date, $4::date, $5, $6)
     RETURNING id, company_id AS "companyId", title,
               starts_on AS "startsOn", ends_on AS "endsOn", status,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cid, safeTitle, start, end, st, createdByUserId || null]
  );
  return { ok: true, cycle: enrichCycle(mapCycle(res.rows[0]), []) };
}

async function updateOkrCycleRow(dbOrQuery, {
  companyId,
  cycleId,
  title,
  startsOn,
  endsOn,
  status,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const id = Number(cycleId);
  if (!Number.isFinite(cid) || !Number.isFinite(id)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const sets = ['updated_at = NOW()'];
  const params = [cid, id];
  let n = 3;
  if (title !== undefined) {
    const safeTitle = String(title || '').trim().slice(0, 200);
    if (!safeTitle) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`title = $${n++}`);
    params.push(safeTitle);
  }
  if (startsOn !== undefined) {
    const d = dateOrNull(startsOn);
    if (!d) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`starts_on = $${n++}::date`);
    params.push(d);
  }
  if (endsOn !== undefined) {
    const d = dateOrNull(endsOn);
    if (!d) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`ends_on = $${n++}::date`);
    params.push(d);
  }
  if (status !== undefined) {
    if (!OKR_CYCLE_STATUSES.includes(status)) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`status = $${n++}`);
    params.push(status);
  }
  if (sets.length === 1) return { ok: false, errorCode: ERR.INVALID_DATA };

  const res = await db.query(
    `UPDATE okr_cycles SET ${sets.join(', ')}
     WHERE id = $2 AND company_id = $1
     RETURNING id, company_id AS "companyId", title,
               starts_on AS "startsOn", ends_on AS "endsOn", status,
               created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    params
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, cycle: mapCycle(res.rows[0]) };
}

export async function updateOkrCycle(dbOrQuery, input) {
  const work = async db => {
    const row = (await db.query('SELECT * FROM okr_cycles WHERE company_id=$1 AND id=$2 FOR UPDATE',[input.companyId,input.cycleId])).rows[0];
    if (!row) return {ok:false,errorCode:ERR.NOT_FOUND};
    if (input.startsOn !== undefined || input.endsOn !== undefined) {
      const start=dateOrNull(input.startsOn ?? row.starts_on), end=dateOrNull(input.endsOn ?? row.ends_on);
      if (!start || !end || start>end || row.status==='closed') return {ok:false,errorCode:ERR.INVALID_DATA};
      const outside=await db.query(`SELECT 1 FROM okr_objectives o JOIN okr_areas a ON a.id=o.area_id AND a.company_id=o.company_id WHERE a.company_id=$1 AND a.cycle_id=$2 AND (o.period_start<$3 OR o.period_end>$4) LIMIT 1`,[input.companyId,input.cycleId,start,end]);
      if(outside.rowCount) return {ok:false,errorCode:ERR.INVALID_DATA};
    }
    return updateOkrCycleRow(db,input);
  };
  return dbOrQuery ? work(asDb(dbOrQuery)) : withTransaction(work);
}

export async function deleteOkrCycle(dbOrQuery, { companyId, cycleId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM okr_cycles WHERE id = $2 AND company_id = $1 AND status <> 'closed' RETURNING id`,
    [Number(companyId), Number(cycleId)]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

async function createOkrAreaRow(dbOrQuery, {
  companyId,
  cycleId,
  title,
  teamGroupId = null,
  sortOrder = 0,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cyId = Number(cycleId);
  const safeTitle = String(title || '').trim().slice(0, 200);
  if (!Number.isFinite(cid) || !Number.isFinite(cyId) || !safeTitle) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const owner = await db.query(
    `SELECT id FROM okr_cycles WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cyId, cid]
  );
  if (owner.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_areas WHERE cycle_id = $1 AND company_id = $2`,
    [cyId, cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_AREA_CAP_PER_CYCLE) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  let groupId = teamGroupId ? Number(teamGroupId) : null;
  if (groupId) {
    const g = await db.query(
      `SELECT id FROM team_groups WHERE id = $1 AND company_id = $2 AND deleted = FALSE LIMIT 1`,
      [groupId, cid]
    );
    if (g.rowCount === 0) groupId = null;
  }

  const res = await db.query(
    `INSERT INTO okr_areas (company_id, cycle_id, title, sort_order, team_group_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id AS "companyId", cycle_id AS "cycleId", title,
               sort_order AS "sortOrder", team_group_id AS "teamGroupId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [cid, cyId, safeTitle, Number(sortOrder) || 0, groupId]
  );
  return {
    ok: true,
    area: { ...mapArea(res.rows[0]), activities: [], progressPct: null, activityCount: 0 },
  };
}

export async function createOkrArea(dbOrQuery, input) {
  const work=async db=> {
    const row=(await db.query('SELECT status FROM okr_cycles WHERE company_id=$1 AND id=$2 FOR UPDATE',[input.companyId,input.cycleId])).rows[0];
    if(!row) return {ok:false,errorCode:ERR.NOT_FOUND};
    if(row.status==='closed') return {ok:false,errorCode:ERR.INVALID_ACTION};
    return createOkrAreaRow(db,input);
  };
  return dbOrQuery ? work(asDb(dbOrQuery)) : withTransaction(work);
}

export async function deleteOkrArea(dbOrQuery, input) {
  const work=async db=> {
    const row=(await db.query(`SELECT c.status FROM okr_cycles c JOIN okr_areas a ON a.cycle_id=c.id AND a.company_id=c.company_id WHERE a.company_id=$1 AND a.id=$2 FOR UPDATE OF c`,[input.companyId,input.areaId])).rows[0];
    if(!row) return {ok:false,errorCode:ERR.NOT_FOUND};
    if(row.status==='closed') return {ok:false,errorCode:ERR.INVALID_ACTION};
    return deleteOkrAreaRow(db,input);
  };
  return dbOrQuery ? work(asDb(dbOrQuery)) : withTransaction(work);
}

export async function updateOkrArea(dbOrQuery, input) {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) return { ok: false, errorCode: ERR.INVALID_DATA };
  const work=async db=> {
    const row=(await db.query(`SELECT c.status FROM okr_cycles c JOIN okr_areas a ON a.cycle_id=c.id AND a.company_id=c.company_id WHERE a.company_id=$1 AND a.id=$2 FOR UPDATE OF c`,[input.companyId,input.areaId])).rows[0];
    if(!row) return {ok:false,errorCode:ERR.NOT_FOUND};
    if(row.status==='closed') return {ok:false,errorCode:ERR.INVALID_ACTION};
    const res=await db.query(
      `UPDATE okr_areas SET title=$3, updated_at=NOW() WHERE company_id=$1 AND id=$2
       RETURNING id, company_id AS "companyId", cycle_id AS "cycleId", title,
                 sort_order AS "sortOrder", team_group_id AS "teamGroupId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [Number(input.companyId),Number(input.areaId),title]
    );
    return {ok:true,area:mapArea(res.rows[0])};
  };
  return dbOrQuery ? work(asDb(dbOrQuery)) : withTransaction(work);
}

async function deleteOkrAreaRow(dbOrQuery, { companyId, areaId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM okr_areas WHERE id = $2 AND company_id = $1 RETURNING id`,
    [Number(companyId), Number(areaId)]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

export async function createOkrActivity(dbOrQuery, {
  companyId,
  areaId,
  title,
  progressPct = 0,
  deadline = null,
  sortOrder = 0,
  weight = 1,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const aId = Number(areaId);
  const safeTitle = String(title || '').trim().slice(0, 300);
  if (!Number.isFinite(cid) || !Number.isFinite(aId) || !safeTitle) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const owner = await db.query(
    `SELECT id FROM okr_areas WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [aId, cid]
  );
  if (owner.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_activities WHERE area_id = $1 AND company_id = $2`,
    [aId, cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_ACTIVITY_CAP_PER_AREA) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const w = clampWeight(weight);
  try {
    const res = await db.query(
      `INSERT INTO okr_activities (
         company_id, area_id, title, progress_pct, deadline, sort_order, weight
       ) VALUES ($1, $2, $3, $4, $5::date, $6, $7)
       RETURNING id, company_id AS "companyId", area_id AS "areaId", title,
                 progress_pct AS "progressPct", weight, deadline, sort_order AS "sortOrder",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        cid,
        aId,
        safeTitle,
        clampPct(progressPct),
        dateOrNull(deadline),
        Number(sortOrder) || 0,
        w,
      ]
    );
    return { ok: true, activity: mapActivity(res.rows[0]) };
  } catch (err) {
    if (err?.code !== '42703') throw err;
    const res = await db.query(
      `INSERT INTO okr_activities (
         company_id, area_id, title, progress_pct, deadline, sort_order
       ) VALUES ($1, $2, $3, $4, $5::date, $6)
       RETURNING id, company_id AS "companyId", area_id AS "areaId", title,
                 progress_pct AS "progressPct", deadline, sort_order AS "sortOrder",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        cid,
        aId,
        safeTitle,
        clampPct(progressPct),
        dateOrNull(deadline),
        Number(sortOrder) || 0,
      ]
    );
    return { ok: true, activity: mapActivity(res.rows[0]) };
  }
}

export async function updateOkrActivity(dbOrQuery, {
  companyId,
  activityId,
  title,
  progressPct,
  deadline,
  weight,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const id = Number(activityId);
  if (!Number.isFinite(cid) || !Number.isFinite(id)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const sets = ['updated_at = NOW()'];
  const params = [cid, id];
  let n = 3;
  if (title !== undefined) {
    const safeTitle = String(title || '').trim().slice(0, 300);
    if (!safeTitle) return { ok: false, errorCode: ERR.INVALID_DATA };
    sets.push(`title = $${n++}`);
    params.push(safeTitle);
  }
  if (progressPct !== undefined) {
    sets.push(`progress_pct = $${n++}`);
    params.push(clampPct(progressPct));
  }
  if (deadline !== undefined) {
    sets.push(`deadline = $${n++}::date`);
    params.push(dateOrNull(deadline));
  }
  if (weight !== undefined) {
    sets.push(`weight = $${n++}`);
    params.push(clampWeight(weight));
  }
  if (sets.length === 1) return { ok: false, errorCode: ERR.INVALID_DATA };

  try {
    const res = await db.query(
      `UPDATE okr_activities SET ${sets.join(', ')}
       WHERE id = $2 AND company_id = $1
       RETURNING id, company_id AS "companyId", area_id AS "areaId", title,
                 progress_pct AS "progressPct", weight, deadline, sort_order AS "sortOrder",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      params
    );
    if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    return { ok: true, activity: mapActivity(res.rows[0]) };
  } catch (err) {
    if (err?.code !== '42703' || weight === undefined) throw err;
    const setsNoW = sets.filter((s) => !s.startsWith('weight'));
    if (setsNoW.length === 1) return { ok: false, errorCode: ERR.INVALID_DATA };
    const paramsNoW = [cid, id];
    let m = 3;
    const rebuilt = ['updated_at = NOW()'];
    if (title !== undefined) {
      rebuilt.push(`title = $${m++}`);
      paramsNoW.push(String(title || '').trim().slice(0, 300));
    }
    if (progressPct !== undefined) {
      rebuilt.push(`progress_pct = $${m++}`);
      paramsNoW.push(clampPct(progressPct));
    }
    if (deadline !== undefined) {
      rebuilt.push(`deadline = $${m++}::date`);
      paramsNoW.push(dateOrNull(deadline));
    }
    const res = await db.query(
      `UPDATE okr_activities SET ${rebuilt.join(', ')}
       WHERE id = $2 AND company_id = $1
       RETURNING id, company_id AS "companyId", area_id AS "areaId", title,
                 progress_pct AS "progressPct", deadline, sort_order AS "sortOrder",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      paramsNoW
    );
    if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
    return { ok: true, activity: mapActivity(res.rows[0]) };
  }
}

export async function deleteOkrActivity(dbOrQuery, { companyId, activityId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM okr_activities WHERE id = $2 AND company_id = $1 RETURNING id`,
    [Number(companyId), Number(activityId)]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

/**
 * Link a collaborator to an activity (idempotent). Notifies on first insert.
 */
export async function addOkrActivityAssignee(dbOrQuery, {
  companyId,
  activityId,
  candidateId,
  assignedByUserId = null,
  notify = true,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const aid = Number(activityId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(aid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const act = await db.query(
    `SELECT a.id, a.title, a.progress_pct AS "progressPct", a.deadline,
            ar.title AS "areaTitle", cy.title AS "cycleTitle", cy.id AS "cycleId"
     FROM okr_activities a
     JOIN okr_areas ar ON ar.id = a.area_id AND ar.company_id = a.company_id
     JOIN okr_cycles cy ON cy.id = ar.cycle_id AND cy.company_id = a.company_id
     WHERE a.id = $1 AND a.company_id = $2
     LIMIT 1`,
    [aid, cid]
  );
  if (act.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const person = await db.query(
    `SELECT id, full_name AS "fullName", email
     FROM candidates
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     LIMIT 1`,
    [cand, cid]
  );
  if (person.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const existing = await db.query(
    `SELECT id FROM okr_activity_assignees
     WHERE activity_id = $1 AND candidate_id = $2 AND company_id = $3
     LIMIT 1`,
    [aid, cand, cid]
  );
  if (existing.rowCount > 0) {
    return {
      ok: true,
      inserted: false,
      assignee: {
        candidateId: cand,
        fullName: person.rows[0].fullName || '',
        email: person.rows[0].email || '',
      },
    };
  }

  const count = await db.query(
    `SELECT COUNT(*)::int AS n FROM okr_activity_assignees
     WHERE activity_id = $1 AND company_id = $2`,
    [aid, cid]
  );
  if ((count.rows[0]?.n || 0) >= OKR_ASSIGNEE_CAP_PER_ACTIVITY) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const ins = await db.query(
    `INSERT INTO okr_activity_assignees (
       company_id, activity_id, candidate_id, assigned_by_user_id
     ) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [cid, aid, cand, assignedByUserId || null]
  );
  const inserted = (ins.rowCount || 0) > 0;

  if (inserted && notify) {
    try {
      const { notifyCandidate, EMPLOYEE_NOTIF } = await import('./employee-notifications.js');
      const row = act.rows[0];
      await notifyCandidate(db, {
        companyId: cid,
        candidateId: cand,
        type: EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED,
        payload: {
          activityTitle: row.title,
          areaTitle: row.areaTitle,
          cycleTitle: row.cycleTitle,
          deadline: dateOrNull(row.deadline),
          progressPct: clampPct(row.progressPct),
        },
        entityType: 'okr_activity',
        entityId: aid,
        dedupeKey: `okr-assign-${aid}-${cand}`,
      });
    } catch (err) {
      console.error('okr assignee notify', err?.message || err);
    }
  }

  return {
    ok: true,
    inserted,
    assignee: {
      candidateId: cand,
      fullName: person.rows[0].fullName || '',
      email: person.rows[0].email || '',
    },
  };
}

export async function removeOkrActivityAssignee(dbOrQuery, {
  companyId,
  activityId,
  candidateId,
}) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `DELETE FROM okr_activity_assignees
     WHERE company_id = $1 AND activity_id = $2 AND candidate_id = $3
     RETURNING id`,
    [Number(companyId), Number(activityId), Number(candidateId)]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true };
}

/**
 * Activities assigned to a collaborator (active cycles preferred first).
 */
export async function listOkrActivitiesForCandidate(dbOrQuery, {
  companyId,
  candidateId,
  limit = 40,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(cand)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const cap = Math.min(40, Math.max(1, Number(limit) || 40));

  try {
    const res = await db.query(
      `SELECT a.id, a.company_id AS "companyId", a.area_id AS "areaId", a.title,
              a.progress_pct AS "progressPct", a.weight, a.deadline, a.sort_order AS "sortOrder",
              a.created_at AS "createdAt", a.updated_at AS "updatedAt",
              ar.title AS "areaTitle",
              cy.id AS "cycleId", cy.title AS "cycleTitle", cy.status AS "cycleStatus",
              cy.starts_on AS "cycleStartsOn", cy.ends_on AS "cycleEndsOn",
              asg.assigned_at AS "assignedAt"
       FROM okr_activity_assignees asg
       JOIN okr_activities a
         ON a.id = asg.activity_id AND a.company_id = asg.company_id
       JOIN okr_areas ar
         ON ar.id = a.area_id AND ar.company_id = a.company_id
       JOIN okr_cycles cy
         ON cy.id = ar.cycle_id AND cy.company_id = a.company_id
       WHERE asg.company_id = $1 AND asg.candidate_id = $2
       ORDER BY
         CASE cy.status WHEN 'active' THEN 0 ELSE 1 END,
         a.deadline ASC NULLS LAST,
         asg.assigned_at DESC,
         a.id DESC
       LIMIT $3`,
      [cid, cand, cap]
    );
    const items = (res.rows || []).map((row) => {
      const base = mapActivity(row);
      return {
        ...base,
        areaTitle: row.areaTitle || '',
        cycleId: Number(row.cycleId),
        cycleTitle: row.cycleTitle || '',
        cycleStatus: row.cycleStatus,
        cycleStartsOn: dateOrNull(row.cycleStartsOn),
        cycleEndsOn: dateOrNull(row.cycleEndsOn),
        assignedAt: row.assignedAt,
      };
    });
    return { ok: true, items };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      try {
        const res = await db.query(
          `SELECT a.id, a.company_id AS "companyId", a.area_id AS "areaId", a.title,
                  a.progress_pct AS "progressPct", a.deadline, a.sort_order AS "sortOrder",
                  a.created_at AS "createdAt", a.updated_at AS "updatedAt",
                  ar.title AS "areaTitle",
                  cy.id AS "cycleId", cy.title AS "cycleTitle", cy.status AS "cycleStatus",
                  cy.starts_on AS "cycleStartsOn", cy.ends_on AS "cycleEndsOn",
                  asg.assigned_at AS "assignedAt"
           FROM okr_activity_assignees asg
           JOIN okr_activities a
             ON a.id = asg.activity_id AND a.company_id = asg.company_id
           JOIN okr_areas ar
             ON ar.id = a.area_id AND ar.company_id = a.company_id
           JOIN okr_cycles cy
             ON cy.id = ar.cycle_id AND cy.company_id = a.company_id
           WHERE asg.company_id = $1 AND asg.candidate_id = $2
           ORDER BY
             CASE cy.status WHEN 'active' THEN 0 ELSE 1 END,
             a.deadline ASC NULLS LAST,
             asg.assigned_at DESC,
             a.id DESC
           LIMIT $3`,
          [cid, cand, cap]
        );
        const items = (res.rows || []).map((row) => {
          const base = mapActivity(row);
          return {
            ...base,
            areaTitle: row.areaTitle || '',
            cycleId: Number(row.cycleId),
            cycleTitle: row.cycleTitle || '',
            cycleStatus: row.cycleStatus,
            cycleStartsOn: dateOrNull(row.cycleStartsOn),
            cycleEndsOn: dateOrNull(row.cycleEndsOn),
            assignedAt: row.assignedAt,
          };
        });
        return { ok: true, items };
      } catch (err2) {
        if (err2?.code === '42P01' || err2?.code === '42703') {
          return { ok: true, items: [] };
        }
        throw err2;
      }
    }
    throw err;
  }
}

/**
 * List check-ins for an activity (newest first). Cap per activity.
 */
export async function listOkrActivityCheckins(dbOrQuery, {
  companyId,
  activityId,
  limit = 20,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const aid = Number(activityId);
  if (!Number.isFinite(cid) || !Number.isFinite(aid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const cap = Math.min(OKR_CHECKIN_CAP_PER_ACTIVITY, Math.max(1, Number(limit) || 20));

  try {
    const owner = await db.query(
      `SELECT id FROM okr_activities WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [aid, cid]
    );
    if (owner.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

    const res = await db.query(
      `SELECT c.id, c.company_id AS "companyId", c.activity_id AS "activityId",
              c.progress_pct AS "progressPct", c.note,
              c.created_by_user_id AS "createdByUserId",
              c.created_by_candidate_id AS "createdByCandidateId",
              c.created_at AS "createdAt",
              COALESCE(NULLIF(BTRIM(u.display_name), ''), u.email, cand.full_name, '') AS "createdByName"
       FROM okr_activity_checkins c
       LEFT JOIN users u ON u.id = c.created_by_user_id
       LEFT JOIN candidates cand
         ON cand.id = c.created_by_candidate_id AND cand.company_id = c.company_id
       WHERE c.company_id = $1 AND c.activity_id = $2
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT $3`,
      [cid, aid, cap]
    );
    return { ok: true, items: (res.rows || []).map(mapCheckin) };
  } catch (err) {
    if (err?.code === '42P01') return { ok: true, items: [] };
    throw err;
  }
}

/**
 * Create check-in and set activity progress_pct.
 * Manager: pass createdByUserId. Assignee: pass createdByCandidateId (must be linked).
 */
export async function createOkrActivityCheckin(dbOrQuery, {
  companyId,
  activityId,
  progressPct,
  note = '',
  createdByUserId = null,
  createdByCandidateId = null,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const aid = Number(activityId);
  const pct = clampPct(progressPct);
  const safeNote = String(note || '').trim().slice(0, OKR_CHECKIN_NOTE_MAX);
  const uid =
    createdByUserId != null && Number.isFinite(Number(createdByUserId))
      ? Number(createdByUserId)
      : null;
  const candId =
    createdByCandidateId != null && Number.isFinite(Number(createdByCandidateId))
      ? Number(createdByCandidateId)
      : null;

  if (!Number.isFinite(cid) || !Number.isFinite(aid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  if (uid == null && candId == null) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  const act = await db.query(
    `SELECT id, title FROM okr_activities WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [aid, cid]
  );
  if (act.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  if (candId != null && uid == null) {
    const link = await db.query(
      `SELECT id FROM okr_activity_assignees
       WHERE company_id = $1 AND activity_id = $2 AND candidate_id = $3
       LIMIT 1`,
      [cid, aid, candId]
    );
    if (link.rowCount === 0) return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }

  try {
    const count = await db.query(
      `SELECT COUNT(*)::int AS n FROM okr_activity_checkins
       WHERE company_id = $1 AND activity_id = $2`,
      [cid, aid]
    );
    if ((count.rows[0]?.n || 0) >= OKR_CHECKIN_CAP_PER_ACTIVITY) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }

    const ins = await db.query(
      `INSERT INTO okr_activity_checkins (
         company_id, activity_id, progress_pct, note,
         created_by_user_id, created_by_candidate_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_id AS "companyId", activity_id AS "activityId",
                 progress_pct AS "progressPct", note,
                 created_by_user_id AS "createdByUserId",
                 created_by_candidate_id AS "createdByCandidateId",
                 created_at AS "createdAt"`,
      [cid, aid, pct, safeNote, uid, candId]
    );

    await db.query(
      `UPDATE okr_activities
       SET progress_pct = $3, updated_at = NOW()
       WHERE id = $2 AND company_id = $1`,
      [cid, aid, pct]
    );

    return {
      ok: true,
      checkin: mapCheckin(ins.rows[0]),
      activity: { id: aid, progressPct: pct, title: act.rows[0].title },
    };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    throw err;
  }
}
