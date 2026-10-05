/**
 * Read side of collaborator time requests (migration 142), shared by the mirror
 * and the request workflow. No writes here.
 */

import { TIME_REQUEST_PUNCH_ACTION, TIME_REQUEST_STATUS } from '../domain-status.js';

export const TIME_REQUESTS_RANGE_CAP = 200;

export const TIME_REQUEST_COLUMNS = `
  r.id, r.company_id AS "companyId", r.candidate_id AS "candidateId", r.kind,
  to_char(r.work_on, 'YYYY-MM-DD') AS "day", r.status, r.justification,
  r.excuse_reason AS "excuseReason",
  to_char(r.excuse_start, 'HH24:MI') AS "excuseStart",
  to_char(r.excuse_end, 'HH24:MI') AS "excuseEnd",
  r.file_key IS NOT NULL AS "hasFile", r.file_name AS "fileName",
  r.decided_at AS "decidedAt", r.decision_note AS "decisionNote",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  COALESCE(du.display_name, du.email) AS "decidedByName"`;

export const TIME_REQUEST_JOINS = 'LEFT JOIN users du ON du.id = r.decided_by_user_id';

export function mapTimeRequest(row, changes = []) {
  return {
    id: Number(row.id),
    candidateId: Number(row.candidateId),
    kind: row.kind,
    day: row.day,
    status: row.status,
    justification: row.justification || '',
    excuseReason: row.excuseReason || null,
    excuseStart: row.excuseStart || null,
    excuseEnd: row.excuseEnd || null,
    hasFile: Boolean(row.hasFile),
    fileName: row.fileName || '',
    decidedAt: row.decidedAt || null,
    decidedByName: row.decidedByName || null,
    decisionNote: row.decisionNote || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    changes,
  };
}

/** Proposed changes for many requests in one query; void rows carry the original time. */
export async function loadTimeRequestChanges(db, requestIds, timeZone) {
  const ids = [...new Set((requestIds || []).map(Number).filter((n) => n > 0))];
  const byRequest = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byRequest;
  const r = await db.query(
    `SELECT i.request_id AS "requestId", i.action, i.punch_id AS "punchId",
            CASE WHEN i.action = '${TIME_REQUEST_PUNCH_ACTION.VOID}'
                 THEN to_char(p.punched_at AT TIME ZONE $2, 'HH24:MI')
                 ELSE to_char(i.punch_time, 'HH24:MI') END AS "time",
            COALESCE(i.punch_kind, p.punch_kind) AS "kind"
     FROM employee_time_request_punches i
     LEFT JOIN employee_time_punches p ON p.id = i.punch_id
     WHERE i.request_id = ANY($1::bigint[])
     ORDER BY i.request_id, "time", i.id`,
    [ids, timeZone]
  );
  for (const row of r.rows || []) {
    byRequest.get(Number(row.requestId))?.push({
      action: row.action,
      punchId: row.punchId != null ? Number(row.punchId) : null,
      time: row.time,
      kind: row.kind,
    });
  }
  return byRequest;
}

/** Non-cancelled requests of one person in [from, to], grouped by day (newest first). */
export async function listTimeRequestsByDay(db, { companyId, candidateId, from, to, timeZone }) {
  const r = await db.query(
    `SELECT ${TIME_REQUEST_COLUMNS}
     FROM employee_time_requests r
     ${TIME_REQUEST_JOINS}
     WHERE r.company_id = $1 AND r.candidate_id = $2
       AND r.work_on BETWEEN $3::date AND $4::date
       AND r.status <> '${TIME_REQUEST_STATUS.CANCELLED}'
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${TIME_REQUESTS_RANGE_CAP}`,
    [companyId, candidateId, from, to]
  );
  const rows = r.rows || [];
  const changes = await loadTimeRequestChanges(db, rows.map((row) => row.id), timeZone);
  const byDay = new Map();
  for (const row of rows) {
    const item = mapTimeRequest(row, changes.get(Number(row.id)) || []);
    if (!byDay.has(item.day)) byDay.set(item.day, []);
    byDay.get(item.day).push(item);
  }
  return byDay;
}
