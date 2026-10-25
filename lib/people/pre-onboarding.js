/**
 * Light pre-onboarding checklist at hire (accesses / D1) — B-702.
 * Not admissions / LMS / document suite.
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { CHECKLIST_ITEM_STATUS, CHECKLIST_ITEM_STATUSES, EMPLOYMENT_STATUS } from '../domain-status.js';
import {
  ensureCompanyPreOnboardingTemplate,
  listCompanyPreOnboardingTemplate,
  templateLabel,
} from './pre-onboarding-template.js';
import { PRE_ONBOARDING_OWNER_ROLES } from './pre-onboarding-constants.js';
import { getOnboardingStageChoice } from './onboarding-stage-choices.js';

export const PRE_ONBOARDING_KEYS = Object.freeze([
  'welcome_kit',
  'access_sheet',
  'rh_onboarding_call',
  'manager_onboarding',
]);

/** Meet-required call owners (subset of PRE_ONBOARDING_OWNER_ROLES). */
const CALL_OWNERS = new Set(
  PRE_ONBOARDING_OWNER_ROLES.filter((r) => r === 'rh' || r === 'manager')
);
const MEET_URL_MAX = 512;

const NOTES_MAX = 2000;
const STATUSES = new Set(CHECKLIST_ITEM_STATUSES);
const PULSE_CAP = 8;

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

function normalizeMeetUrl(raw) {
  const s = String(raw || '').trim().slice(0, MEET_URL_MAX);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

function mapRow(r) {
  const due = dateOrNull(r.dueDate);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    candidateId: Number(r.candidateId),
    itemKey: r.itemKey,
    label: r.labelSnapshot || '',
    ownerRole: r.ownerRole || 'rh',
    dueDate: due,
    status: r.status,
    notes: r.notes || '',
    meetUrl: r.meetUrl || null,
    employeeAckAt: r.employeeAckAt || null,
    completedAt: r.completedAt || null,
    completedByUserId: r.completedByUserId != null ? Number(r.completedByUserId) : null,
    overdue: r.status === CHECKLIST_ITEM_STATUS.PENDING && due && due < today,
    requireMeet: Boolean(r.requireMeet),
    allowMeet: Boolean(r.requireMeet)
      || CALL_OWNERS.has(r.ownerRole || 'rh')
      || ['rh_onboarding_call', 'manager_onboarding'].includes(r.itemKey),
  };
}

/**
 * Idempotent seed after hire — uses company template when present.
 */
export async function ensurePreOnboardingChecklist(dbOrQuery, { companyId, candidateId, locale = 'pt-BR' }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(candId) || candId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const cand = await db.query(
    `SELECT id, company_id AS "companyId",
            employment_status AS "employmentStatus",
            start_date AS "startDate",
            hired_at AS "hiredAt"
     FROM candidates
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [candId, cid]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = cand.rows[0];
  if (row.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return { ok: true, skipped: true, items: [] };
  }

  const start =
    dateOrNull(row.startDate) ||
    (row.hiredAt ? String(row.hiredAt).slice(0, 10) : null) ||
    new Date().toISOString().slice(0, 10);

  await ensureCompanyPreOnboardingTemplate(db, { companyId: cid });
  const tpl = await listCompanyPreOnboardingTemplate(db, { companyId: cid });
  const seeds = (tpl.items || []).filter((x) => x.active);
  const choice = await getOnboardingStageChoice(db, { companyId: cid, candidateId: candId, stage: 'arrival' });
  const list = seeds.length
    ? seeds
    : PRE_ONBOARDING_KEYS.map((itemKey, i) => ({
        itemKey,
        ownerRole: itemKey.includes('manager') ? 'manager' : itemKey.includes('access') ? 'it' : 'rh',
        dueOffsetDays: 0,
        labelPt: itemKey,
        labelEn: itemKey,
        sortOrder: (i + 1) * 10,
      }));

  for (const item of list) {
    const due = addDaysIso(start, item.dueOffsetDays || 0) || start;
    const label = templateLabel(item, locale);
    try {
      await db.query(
        `INSERT INTO employee_pre_onboarding_items (
           company_id, candidate_id, item_key, due_date, owner_role, label_snapshot, require_meet,
           status, completed_at, completed_by_user_id
         ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (candidate_id, item_key) DO NOTHING`,
        [
          cid,
          candId,
          item.itemKey,
          due,
          item.ownerRole || 'rh',
          label,
          Boolean(item.requireMeet),
          choice.enabled ? 'pending' : 'skipped',
          choice.enabled ? null : choice.decidedAt,
          choice.enabled ? null : choice.actorId,
        ]
      );
    } catch (err) {
      // Pre-migration fallbacks (owner/label and/or require_meet)
      if (err?.code === '42703' && choice.enabled) {
        try {
          await db.query(
            `INSERT INTO employee_pre_onboarding_items (
               company_id, candidate_id, item_key, due_date, owner_role, label_snapshot
             ) VALUES ($1, $2, $3, $4::date, $5, $6)
             ON CONFLICT (candidate_id, item_key) DO NOTHING`,
            [cid, candId, item.itemKey, due, item.ownerRole || 'rh', label]
          );
        } catch (err2) {
          if (err2?.code === '42703') {
            await db.query(
              `INSERT INTO employee_pre_onboarding_items (
                 company_id, candidate_id, item_key, due_date
               ) VALUES ($1, $2, $3, $4::date)
               ON CONFLICT (candidate_id, item_key) DO NOTHING`,
              [cid, candId, item.itemKey, due]
            );
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }
  }

  const items = await listPreOnboardingItems(db, { companyId: cid, candidateId: candId });
  return { ok: true, startDate: start, items };
}

export async function listPreOnboardingItems(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  try {
    const res = await db.query(
      `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
              item_key AS "itemKey", due_date AS "dueDate",
              status, notes, meet_url AS "meetUrl",
              employee_ack_at AS "employeeAckAt",
              completed_at AS "completedAt",
              completed_by_user_id AS "completedByUserId",
              COALESCE(owner_role, 'rh') AS "ownerRole",
              COALESCE(label_snapshot, '') AS "labelSnapshot",
              COALESCE(require_meet, FALSE) AS "requireMeet"
       FROM employee_pre_onboarding_items
       WHERE company_id = $1 AND candidate_id = $2
       ORDER BY id ASC`,
      [companyId, candidateId]
    );
    return (res.rows || []).map(mapRow);
  } catch (err) {
    if (err?.code === '42P01') return [];
    if (err?.code === '42703') {
      try {
        const res = await db.query(
          `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
                  item_key AS "itemKey", due_date AS "dueDate",
                  status, notes, meet_url AS "meetUrl",
                  employee_ack_at AS "employeeAckAt",
                  completed_at AS "completedAt",
                  completed_by_user_id AS "completedByUserId",
                  COALESCE(owner_role, 'rh') AS "ownerRole",
                  COALESCE(label_snapshot, '') AS "labelSnapshot"
           FROM employee_pre_onboarding_items
           WHERE company_id = $1 AND candidate_id = $2
           ORDER BY id ASC`,
          [companyId, candidateId]
        );
        return (res.rows || []).map((r) => mapRow({ ...r, requireMeet: false }));
      } catch (err2) {
        if (err2?.code !== '42703') throw err2;
        const res = await db.query(
          `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
                  item_key AS "itemKey", due_date AS "dueDate",
                  status, notes, meet_url AS "meetUrl",
                  employee_ack_at AS "employeeAckAt",
                  completed_at AS "completedAt",
                  completed_by_user_id AS "completedByUserId"
           FROM employee_pre_onboarding_items
           WHERE company_id = $1 AND candidate_id = $2
           ORDER BY id ASC`,
          [companyId, candidateId]
        );
        return (res.rows || []).map((r) =>
          mapRow({ ...r, ownerRole: 'rh', labelSnapshot: '', requireMeet: false })
        );
      }
    }
    throw err;
  }
}

export async function updatePreOnboardingItem(dbOrQuery, {
  companyId,
  candidateId,
  itemId,
  status,
  notes,
  meetUrl,
  completedByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const nextStatus = String(status || '').trim().toLowerCase();
  if (!STATUSES.has(nextStatus) || nextStatus === CHECKLIST_ITEM_STATUS.PENDING) {
    return { ok: false, errorCode: ERR.INVALID_STATUS };
  }
  const nextNotes = String(notes || '').trim().slice(0, NOTES_MAX);

  const owned = await db.query(
    `SELECT id, item_key AS "itemKey",
            COALESCE(owner_role, 'rh') AS "ownerRole"
     FROM employee_pre_onboarding_items
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3
     LIMIT 1`,
    [itemId, companyId, candidateId]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const url =
    meetUrl !== undefined &&
    (CALL_OWNERS.has(owned.rows[0].ownerRole)
      || ['rh_onboarding_call', 'manager_onboarding'].includes(owned.rows[0].itemKey))
      ? normalizeMeetUrl(meetUrl)
      : undefined;

  const res = await db.query(
    `UPDATE employee_pre_onboarding_items
     SET status = $2,
         notes = $3,
         meet_url = CASE WHEN $5::boolean THEN $6 ELSE meet_url END,
         completed_at = NOW(),
         completed_by_user_id = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               item_key AS "itemKey", due_date AS "dueDate",
               status, notes, meet_url AS "meetUrl",
               employee_ack_at AS "employeeAckAt",
               completed_at AS "completedAt",
               completed_by_user_id AS "completedByUserId"`,
    [itemId, nextStatus, nextNotes, completedByUserId || null, url !== undefined, url]
  );
  return { ok: true, item: mapRow(res.rows[0]) };
}

export async function setPreOnboardingMeetUrl(dbOrQuery, {
  companyId,
  candidateId,
  itemId,
  meetUrl,
}) {
  const db = asDb(dbOrQuery);
  const url = normalizeMeetUrl(meetUrl);
  const owned = await db.query(
    `SELECT id FROM employee_pre_onboarding_items
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3
       AND (
         COALESCE(owner_role, 'rh') IN ('rh', 'manager')
         OR item_key IN ('rh_onboarding_call', 'manager_onboarding')
       )
     LIMIT 1`,
    [itemId, companyId, candidateId]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.NOT_FOUND };

  const res = await db.query(
    `UPDATE employee_pre_onboarding_items
     SET meet_url = $4, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               item_key AS "itemKey", due_date AS "dueDate",
               status, notes, meet_url AS "meetUrl",
               employee_ack_at AS "employeeAckAt",
               completed_at AS "completedAt",
               completed_by_user_id AS "completedByUserId"`,
    [itemId, companyId, candidateId, url]
  );
  return { ok: true, item: mapRow(res.rows[0]) };
}

/**
 * Company pulse for Overview (pending / overdue).
 */
export async function getCompanyPreOnboardingPulse(dbOrQuery, { companyId, limit = PULSE_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || PULSE_CAP), PULSE_CAP);
  try {
    const counts = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = '${CHECKLIST_ITEM_STATUS.PENDING}')::int AS pending,
         COUNT(*) FILTER (WHERE status = '${CHECKLIST_ITEM_STATUS.PENDING}' AND due_date < CURRENT_DATE)::int AS overdue
       FROM employee_pre_onboarding_items
       WHERE company_id = $1`,
      [companyId]
    );
    const rows = await db.query(
      `SELECT i.id, i.item_key AS "itemKey", i.due_date AS "dueDate", i.status,
              c.id AS "candidateId", c.full_name AS "fullName"
       FROM employee_pre_onboarding_items i
       JOIN candidates c ON c.id = i.candidate_id
       WHERE i.company_id = $1 AND i.status = '${CHECKLIST_ITEM_STATUS.PENDING}'
       ORDER BY i.due_date ASC, i.id ASC
       LIMIT $2`,
      [companyId, cap]
    );
    const today = new Date().toISOString().slice(0, 10);
    return {
      pending: Number(counts.rows[0]?.pending) || 0,
      overdue: Number(counts.rows[0]?.overdue) || 0,
      items: (rows.rows || []).map((r) => ({
        id: Number(r.id),
        itemKey: r.itemKey,
        dueDate: dateOrNull(r.dueDate),
        candidateId: Number(r.candidateId),
        fullName: r.fullName || '',
        overdue: dateOrNull(r.dueDate) && dateOrNull(r.dueDate) < today,
      })),
    };
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return { pending: 0, overdue: 0, items: [] };
    }
    throw err;
  }
}
