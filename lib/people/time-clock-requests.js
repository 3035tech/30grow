/**
 * Collaborator time requests (migration 142): punch adjustment or excuse ("abono"),
 * decided by HR/manager. Nothing touches the mirror until approval; approving reuses
 * the manager adjustment/justification path (void + insert, never edit).
 */

import crypto from 'node:crypto';
import { asDb } from '../ae/as-db.js';
import { withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import {
  TIME_REQUEST_DECISION,
  TIME_REQUEST_KIND,
  TIME_REQUEST_KINDS,
  TIME_REQUEST_PUNCH_ACTION,
  TIME_REQUEST_STATUS,
  TIME_REQUEST_STATUSES,
} from '../domain-status.js';
import {
  companyScopedObjectKey,
  deleteObjectBestEffort,
  getObjectBytes,
  isObjectStorageConfigured,
  putObject,
} from '../s3-object-storage.js';
import { assertValidDpDocumentFile } from './employee-dp.js';
import { DEFAULT_SCHEDULE, getCompanyTimeSchedule, getTimeClockAccess, localHmInTz } from './time-clock.js';
import {
  appErrorResult,
  applyTimeDayAdjustment,
  applyTimeDayJustification,
  getEmployeeTimeMirror,
  normalizeTimeAdjustment,
  normalizeTimeExcuse,
  openTimeDayForWrite,
  parseIsoDay,
} from './time-clock-manager.js';
import {
  TIME_REQUEST_COLUMNS,
  TIME_REQUEST_JOINS,
  loadTimeRequestChanges,
  mapTimeRequest,
} from './time-clock-request-rows.js';
import { loadOrgUnitPaths } from './org-units.js';

export const TIME_REQUESTS_PAGE_SIZE = 20;
export const TIME_REQUEST_JUSTIFICATION_MAX = 1000;

const fail = (errorCode) => ({ ok: false, errorCode });
const PG_UNIQUE_VIOLATION = '23505';

function clip(s, max) {
  return String(s || '').trim().slice(0, max);
}

function validIds(...ids) {
  return ids.every((n) => Number.isFinite(n) && n > 0);
}

/**
 * Collaborator submits a request for a past or current day. Serialized per person by
 * the employee row lock; one pending request per day and kind (unique partial index).
 */
export async function createTimeRequest({
  companyId,
  candidateId,
  kind,
  day,
  justification,
  voidPunchIds = [],
  add = [],
  excuseReason = null,
  excuseStart = null,
  excuseEnd = null,
}) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const dayIso = parseIsoDay(day);
  const why = clip(justification, TIME_REQUEST_JUSTIFICATION_MAX);
  if (!validIds(cid, cand)) return fail(ERR.INVALID_ID);
  if (!TIME_REQUEST_KINDS.includes(kind) || !dayIso || why.length < 3) return fail(ERR.INVALID_DATA);

  let adjustment = null;
  let excuse = null;
  if (kind === TIME_REQUEST_KIND.ADJUSTMENT) {
    adjustment = normalizeTimeAdjustment({ voidPunchIds, add, reason: why });
    if (!adjustment.ok) return adjustment;
  } else {
    excuse = normalizeTimeExcuse({ excuseReason, excuseStart, excuseEnd });
    if (!excuse.ok) return excuse;
  }

  const access = await getTimeClockAccess(null, { companyId: cid, candidateId: cand });
  if (!access.ok) return access;
  if (!access.enabled) return fail(ERR.TIME_CLOCK_DISABLED);

  return withTransaction(async (client) => {
    const open = await openTimeDayForWrite(client, { companyId: cid, candidateId: cand, day: dayIso });
    if (!open.ok) return open;
    if (dayIso > open.today) return fail(ERR.INVALID_DATE);

    if (adjustment) {
      if (dayIso === open.today) {
        const now = localHmInTz(new Date(), open.tz);
        if (adjustment.adds.some((a) => a.time > now)) return fail(ERR.INVALID_DATA);
      }
      if (adjustment.voids.length) {
        const owned = await client.query(
          `SELECT COUNT(*)::int AS n FROM employee_time_punches
           WHERE company_id = $1 AND candidate_id = $2 AND id = ANY($3::bigint[])
             AND voided_at IS NULL
             AND punched_at >= ($4::timestamp AT TIME ZONE $5)
             AND punched_at < (($4::timestamp + INTERVAL '1 day') AT TIME ZONE $5)`,
          [cid, cand, adjustment.voids, dayIso, open.tz]
        );
        if (Number(owned.rows[0]?.n) !== adjustment.voids.length) return fail(ERR.TIME_REQUEST_STALE);
      }
    }

    const ins = await client.query(
      `INSERT INTO employee_time_requests
         (company_id, candidate_id, kind, work_on, justification, excuse_reason, excuse_start, excuse_end)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7::time, $8::time)
       RETURNING id`,
      [cid, cand, kind, dayIso, why, excuse?.reason || null, excuse?.start || null, excuse?.end || null]
    );
    const id = Number(ins.rows[0].id);

    if (adjustment) {
      const actions = [];
      const punchIds = [];
      const times = [];
      const kinds = [];
      for (const pid of adjustment.voids) {
        actions.push(TIME_REQUEST_PUNCH_ACTION.VOID);
        punchIds.push(pid);
        times.push(null);
        kinds.push(null);
      }
      for (const a of adjustment.adds) {
        actions.push(TIME_REQUEST_PUNCH_ACTION.ADD);
        punchIds.push(null);
        times.push(a.time);
        kinds.push(a.kind);
      }
      await client.query(
        `INSERT INTO employee_time_request_punches (request_id, action, punch_id, punch_time, punch_kind)
         SELECT $1, a, p, t::time, k
         FROM unnest($2::text[], $3::bigint[], $4::text[], $5::text[]) AS u(a, p, t, k)`,
        [id, actions, punchIds, times, kinds]
      );
    }

    const item = await loadTimeRequest(client, { companyId: cid, id, timeZone: open.tz });
    return { ok: true, item };
  }).catch((e) => {
    if (e?.code === PG_UNIQUE_VIOLATION) return fail(ERR.TIME_REQUEST_DUPLICATE);
    return appErrorResult(e);
  });
}

async function loadTimeRequest(db, { companyId, id, candidateId = null, timeZone }) {
  const params = [companyId, id];
  let where = 'r.company_id = $1 AND r.id = $2';
  if (candidateId != null) {
    params.push(candidateId);
    where += ` AND r.candidate_id = $${params.length}`;
  }
  const r = await db.query(
    `SELECT ${TIME_REQUEST_COLUMNS},
            c.full_name AS "candidateName", c.email AS "candidateEmail", c.org_unit_id AS "orgUnitId"
     FROM employee_time_requests r
     JOIN candidates c ON c.id = r.candidate_id AND c.company_id = r.company_id
     ${TIME_REQUEST_JOINS}
     WHERE ${where}
     LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row) return null;
  const changes = await loadTimeRequestChanges(db, [row.id], timeZone);
  return {
    ...mapTimeRequest(row, changes.get(Number(row.id)) || []),
    candidateName: row.candidateName,
    candidateEmail: row.candidateEmail,
    orgUnitId: row.orgUnitId != null ? Number(row.orgUnitId) : null,
  };
}

async function companyTz(db, companyId) {
  const s = await getCompanyTimeSchedule(db, { companyId });
  return s.schedule?.timezone || DEFAULT_SCHEDULE.timezone;
}

/** Collaborator withdraws an own pending request. */
export async function cancelTimeRequest({ companyId, candidateId, id }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const rid = Number(id);
  if (!validIds(cid, cand, rid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const r = await db.query(
    `UPDATE employee_time_requests
     SET status = '${TIME_REQUEST_STATUS.CANCELLED}', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3
       AND status = '${TIME_REQUEST_STATUS.PENDING}'
     RETURNING id`,
    [rid, cid, cand]
  );
  if (r.rowCount === 0) {
    const exists = await db.query(
      'SELECT 1 FROM employee_time_requests WHERE id = $1 AND company_id = $2 AND candidate_id = $3',
      [rid, cid, cand]
    );
    return fail(exists.rowCount ? ERR.TIME_REQUEST_NOT_PENDING : ERR.NOT_FOUND);
  }
  return { ok: true, id: rid };
}

/** Manager queue, newest first. Bounded page; changes loaded in one batch. */
export async function listTimeRequests(dbOrQuery, {
  companyId,
  status = TIME_REQUEST_STATUS.PENDING,
  q = '',
  page = 1,
  pageSize = TIME_REQUESTS_PAGE_SIZE,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!validIds(cid)) return fail(ERR.COMPANY_REQUIRED);
  const size = Math.min(50, Math.max(5, Number(pageSize) || TIME_REQUESTS_PAGE_SIZE));
  const pg = Math.max(1, Number(page) || 1);
  const params = [cid];
  let where = 'r.company_id = $1';
  if (status && TIME_REQUEST_STATUSES.includes(status)) {
    params.push(status);
    where += ` AND r.status = $${params.length}`;
  }
  const search = String(q || '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (LOWER(c.full_name) LIKE $${params.length} OR LOWER(c.email) LIKE $${params.length})`;
  }
  const from = `FROM employee_time_requests r
     JOIN candidates c ON c.id = r.candidate_id AND c.company_id = r.company_id
     ${TIME_REQUEST_JOINS}
     WHERE ${where}`;
  const countRes = await db.query(`SELECT COUNT(*)::int AS n ${from}`, params);
  params.push(size, (pg - 1) * size);
  const r = await db.query(
    `SELECT ${TIME_REQUEST_COLUMNS},
            c.full_name AS "candidateName", c.email AS "candidateEmail", c.org_unit_id AS "orgUnitId"
     ${from}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const rows = r.rows || [];
  const [changes, pathOf] = await Promise.all([
    loadTimeRequestChanges(db, rows.map((row) => row.id), await companyTz(db, cid)),
    loadOrgUnitPaths(db, cid),
  ]);
  return {
    ok: true,
    page: pg,
    pageSize: size,
    total: Number(countRes.rows[0]?.n) || 0,
    items: rows.map((row) => ({
      ...mapTimeRequest(row, changes.get(Number(row.id)) || []),
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      orgUnitPath: pathOf(row.orgUnitId),
    })),
  };
}

export async function countPendingTimeRequests(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM employee_time_requests
     WHERE company_id = $1 AND status = '${TIME_REQUEST_STATUS.PENDING}'`,
    [Number(companyId)]
  );
  return Number(r.rows[0]?.n) || 0;
}

/** Request + the day as it is today in the mirror (original record for review). */
export async function getTimeRequestDetail(dbOrQuery, { companyId, id }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const rid = Number(id);
  if (!validIds(cid, rid)) return fail(ERR.INVALID_ID);
  const item = await loadTimeRequest(db, { companyId: cid, id: rid, timeZone: await companyTz(db, cid) });
  if (!item) return fail(ERR.NOT_FOUND);
  const mirror = await getEmployeeTimeMirror(db, {
    companyId: cid,
    candidateId: item.candidateId,
    from: item.day,
    to: item.day,
  });
  return { ok: true, item, day: mirror.ok ? mirror.days[0] || null : null, schedule: mirror.ok ? mirror.schedule : null };
}

/**
 * Approve or reject a pending request. Lock order matches createTimeRequest
 * (employee row, then request row) so concurrent submit/decide cannot deadlock.
 */
export async function decideTimeRequest({ companyId, id, decision, note = '', userId = null }) {
  const cid = Number(companyId);
  const rid = Number(id);
  if (!validIds(cid, rid)) return fail(ERR.INVALID_ID);
  if (!Object.values(TIME_REQUEST_DECISION).includes(decision)) return fail(ERR.INVALID_DATA);
  const decisionNote = clip(note, 500);

  return withTransaction(async (client) => {
    const head = await client.query(
      `SELECT candidate_id AS "candidateId", to_char(work_on, 'YYYY-MM-DD') AS "day"
       FROM employee_time_requests WHERE id = $1 AND company_id = $2`,
      [rid, cid]
    );
    if (!head.rowCount) return fail(ERR.NOT_FOUND);
    const cand = Number(head.rows[0].candidateId);
    const dayIso = head.rows[0].day;

    let open = null;
    if (decision === TIME_REQUEST_DECISION.APPROVE) {
      open = await openTimeDayForWrite(client, { companyId: cid, candidateId: cand, day: dayIso });
      if (!open.ok) return open;
    }
    const locked = await client.query(
      `SELECT id, kind, status, justification, excuse_reason AS "excuseReason",
              to_char(excuse_start, 'HH24:MI') AS "excuseStart",
              to_char(excuse_end, 'HH24:MI') AS "excuseEnd"
       FROM employee_time_requests WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [rid, cid]
    );
    const req = locked.rows[0];
    if (req.status !== TIME_REQUEST_STATUS.PENDING) return fail(ERR.TIME_REQUEST_NOT_PENDING);

    let applied = null;
    if (decision === TIME_REQUEST_DECISION.APPROVE) {
      const why = clip(req.justification, 500);
      if (req.kind === TIME_REQUEST_KIND.ADJUSTMENT) {
        const items = await client.query(
          `SELECT action, punch_id AS "punchId", to_char(punch_time, 'HH24:MI') AS "time", punch_kind AS "kind"
           FROM employee_time_request_punches WHERE request_id = $1 ORDER BY id`,
          [rid]
        );
        const rows = items.rows || [];
        applied = await applyTimeDayAdjustment(client, {
          companyId: cid,
          candidateId: cand,
          dayIso,
          tz: open.tz,
          voids: rows.filter((i) => i.action === TIME_REQUEST_PUNCH_ACTION.VOID).map((i) => Number(i.punchId)),
          adds: rows.filter((i) => i.action === TIME_REQUEST_PUNCH_ACTION.ADD).map((i) => ({ time: i.time, kind: i.kind })),
          why,
          userId,
          staleCode: ERR.TIME_REQUEST_STALE,
        });
      } else {
        applied = await applyTimeDayJustification(client, {
          companyId: cid,
          candidateId: cand,
          dayIso,
          reason: req.excuseReason,
          note: why,
          excusedStart: req.excuseStart,
          excusedEnd: req.excuseEnd,
          sourceRequestId: rid,
          userId,
        });
      }
    }

    const status = decision === TIME_REQUEST_DECISION.APPROVE
      ? TIME_REQUEST_STATUS.APPROVED
      : TIME_REQUEST_STATUS.REJECTED;
    await client.query(
      `UPDATE employee_time_requests
       SET status = $3, decided_by_user_id = $4, decided_at = NOW(), decision_note = $5, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [rid, cid, status, userId, decisionNote]
    );
    return { ok: true, id: rid, candidateId: cand, day: dayIso, kind: req.kind, status, applied };
  }).catch(appErrorResult);
}

function requestFilePrefix(companyId, candidateId, id) {
  return companyScopedObjectKey(companyId, `time-requests/${candidateId}/${id}`);
}

/** Collaborator attaches proof to an own pending request (replaces a previous file). */
export async function uploadTimeRequestAttachment({ companyId, candidateId, id, file }) {
  if (!isObjectStorageConfigured()) return fail(ERR.STORAGE_NOT_CONFIGURED);
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const rid = Number(id);
  if (!validIds(cid, cand, rid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const cur = await db.query(
    `SELECT status, file_key AS "fileKey" FROM employee_time_requests
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3`,
    [rid, cid, cand]
  );
  if (!cur.rowCount) return fail(ERR.NOT_FOUND);
  if (cur.rows[0].status !== TIME_REQUEST_STATUS.PENDING) return fail(ERR.TIME_REQUEST_NOT_PENDING);

  const { mimeType } = assertValidDpDocumentFile(file);
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'pdf';
  const objectKey = `${requestFilePrefix(cid, cand, rid)}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const put = await putObject({ key: objectKey, body: file.buffer, contentType: mimeType, cacheControl: 'private, no-store' });
  if (!put?.url) return fail(ERR.INTERNAL);

  const upd = await db.query(
    `UPDATE employee_time_requests SET file_key = $4, file_name = $5, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3 AND status = '${TIME_REQUEST_STATUS.PENDING}'
     RETURNING id`,
    [rid, cid, cand, objectKey, clip(file.originalName || `attachment.${ext}`, 200)]
  );
  if (!upd.rowCount) {
    await deleteObjectBestEffort(objectKey);
    return fail(ERR.TIME_REQUEST_NOT_PENDING);
  }
  const prev = cur.rows[0].fileKey;
  if (prev && prev !== objectKey) await deleteObjectBestEffort(prev);
  return { ok: true, id: rid, hasFile: true };
}

export async function clearTimeRequestAttachment({ companyId, candidateId, id }) {
  const cid = Number(companyId);
  const cand = Number(candidateId);
  const rid = Number(id);
  if (!validIds(cid, cand, rid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const r = await db.query(
    `UPDATE employee_time_requests t SET file_key = NULL, file_name = '', updated_at = NOW()
     FROM (SELECT id, file_key FROM employee_time_requests
           WHERE id = $1 AND company_id = $2 AND candidate_id = $3
             AND status = '${TIME_REQUEST_STATUS.PENDING}' FOR UPDATE) prev
     WHERE t.id = prev.id
     RETURNING prev.file_key AS "fileKey"`,
    [rid, cid, cand]
  );
  if (!r.rowCount) return fail(ERR.TIME_REQUEST_NOT_PENDING);
  if (r.rows[0].fileKey) await deleteObjectBestEffort(r.rows[0].fileKey);
  return { ok: true, id: rid, hasFile: false };
}

/** candidateId restricts to the collaborator's own request; omit for HR (company scope). */
export async function downloadTimeRequestAttachment({ companyId, id, candidateId = null }) {
  const cid = Number(companyId);
  const rid = Number(id);
  if (!validIds(cid, rid)) return fail(ERR.INVALID_ID);
  const db = asDb(null);
  const params = [rid, cid];
  let where = 'id = $1 AND company_id = $2';
  if (candidateId != null) {
    params.push(Number(candidateId));
    where += ' AND candidate_id = $3';
  }
  const r = await db.query(
    `SELECT candidate_id AS "candidateId", file_key AS "fileKey", file_name AS "fileName"
     FROM employee_time_requests WHERE ${where} LIMIT 1`,
    params
  );
  const row = r.rows[0];
  if (!row?.fileKey) return fail(ERR.NOT_FOUND);
  if (!String(row.fileKey).startsWith(`${requestFilePrefix(cid, row.candidateId, rid)}/`)) return fail(ERR.NOT_FOUND);
  const object = await getObjectBytes(row.fileKey);
  return { ok: true, body: object.body, contentType: object.contentType, fileName: clip(row.fileName || 'attachment', 200) };
}

function employeePunch(p) {
  return {
    id: p.id,
    punchedAt: p.punchedAt,
    punchKind: p.punchKind,
    source: p.source,
    flag: p.flag,
    voidedAt: p.voidedAt,
    voidReason: p.voidReason,
  };
}

/**
 * Collaborator's own history: the manager mirror minus staff names and coordinates.
 * Same bounded period rules (TIME_MIRROR_MAX_DAYS, clamped to today).
 */
export async function getEmployeeTimeHistory(dbOrQuery, { companyId, candidateId, from, to }) {
  const db = asDb(dbOrQuery);
  const access = await getTimeClockAccess(db, { companyId, candidateId });
  if (!access.ok) return access;
  if (!access.enabled) return fail(ERR.TIME_CLOCK_DISABLED);
  const mirror = await getEmployeeTimeMirror(db, { companyId, candidateId, from, to });
  if (!mirror.ok) return mirror;
  return {
    ok: true,
    from: mirror.from,
    to: mirror.to,
    today: mirror.today,
    maxDays: mirror.maxDays,
    schedule: {
      workdayStart: mirror.schedule.workdayStart,
      workdayEnd: mirror.schedule.workdayEnd,
      breakMinutes: mirror.schedule.breakMinutes,
      hourBankEnabled: mirror.schedule.hourBankEnabled,
      timezone: mirror.schedule.timezone,
    },
    totals: mirror.totals,
    truncated: mirror.truncated,
    days: mirror.days.map((d) => ({
      day: d.day,
      isWorkday: d.isWorkday,
      isToday: d.isToday,
      locked: d.locked,
      occurrence: d.occurrence,
      workedMinutes: d.workedMinutes,
      expectedMinutes: d.expectedMinutes,
      extraMinutes: d.extraMinutes,
      missingMinutes: d.missingMinutes,
      bankBalanceMinutes: d.bankBalanceMinutes,
      holiday: d.holiday ? { name: d.holiday.name } : null,
      daySchedule: d.daySchedule,
      justification: d.justification
        ? {
            reason: d.justification.reason,
            note: d.justification.note,
            excusedStart: d.justification.excusedStart,
            excusedEnd: d.justification.excusedEnd,
          }
        : null,
      punches: d.punches.map(employeePunch),
      requests: d.requests,
    })),
  };
}

