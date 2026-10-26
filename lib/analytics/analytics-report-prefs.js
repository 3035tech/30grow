/**
 * Preferências do relatório Analytics agendado (B-1107).
 */

import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';

export const ANALYTICS_REPORT_FREQUENCIES = Object.freeze(['weekly', 'monthly', 'off']);

const DEFAULT_PREFS = Object.freeze({
  frequency: 'weekly',
  recipientUserIds: [],
  attachPdf: false,
});

function normalizeFrequency(raw) {
  const f = String(raw || '').trim().toLowerCase();
  return ANALYTICS_REPORT_FREQUENCIES.includes(f) ? f : 'weekly';
}

function normalizeUserIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const x of raw) {
    const id = Number(x);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * @param {import('pg').Pool|Function} dbFn
 * @param {number} companyId
 */
export async function getAnalyticsReportPrefs(dbFn, companyId) {
  const db = asDb(dbFn);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_INPUT };
  }
  const r = await db.query(
    `SELECT frequency,
            recipient_user_ids AS "recipientUserIds",
            attach_pdf AS "attachPdf",
            updated_at AS "updatedAt"
     FROM company_analytics_report_prefs
     WHERE company_id = $1
     LIMIT 1`,
    [cid]
  );
  if (!r.rowCount) {
    return { ok: true, prefs: { companyId: cid, ...DEFAULT_PREFS, updatedAt: null } };
  }
  const row = r.rows[0];
  return {
    ok: true,
    prefs: {
      companyId: cid,
      frequency: normalizeFrequency(row.frequency),
      recipientUserIds: normalizeUserIds(row.recipientUserIds),
      attachPdf: row.attachPdf === true,
      updatedAt: row.updatedAt || null,
    },
  };
}

/**
 * @param {import('pg').Pool|Function} dbFn
 * @param {number} companyId
 * @param {{ frequency?: string, recipientUserIds?: number[], attachPdf?: boolean, updatedBy?: number|null }} patch
 */
export async function upsertAnalyticsReportPrefs(dbFn, companyId, patch = {}) {
  const db = asDb(dbFn);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.INVALID_INPUT };
  }

  const current = await getAnalyticsReportPrefs(db, cid);
  if (!current.ok) return current;
  const next = {
    frequency: patch.frequency != null ? normalizeFrequency(patch.frequency) : current.prefs.frequency,
    recipientUserIds:
      patch.recipientUserIds != null
        ? normalizeUserIds(patch.recipientUserIds)
        : current.prefs.recipientUserIds,
    attachPdf: patch.attachPdf != null ? Boolean(patch.attachPdf) : current.prefs.attachPdf,
  };

  if (next.recipientUserIds.length) {
    const check = await db.query(
      `SELECT id FROM users
       WHERE company_id = $1
         AND active = TRUE
         AND deleted = FALSE
         AND id = ANY($2::bigint[])`,
      [cid, next.recipientUserIds]
    );
    const allowed = new Set((check.rows || []).map((r) => Number(r.id)));
    next.recipientUserIds = next.recipientUserIds.filter((id) => allowed.has(id));
  }

  const updatedBy =
    patch.updatedBy != null && Number.isFinite(Number(patch.updatedBy))
      ? Number(patch.updatedBy)
      : null;

  await db.query(
    `INSERT INTO company_analytics_report_prefs
       (company_id, frequency, recipient_user_ids, attach_pdf, updated_at, updated_by)
     VALUES ($1, $2, $3::bigint[], $4, NOW(), $5)
     ON CONFLICT (company_id) DO UPDATE SET
       frequency = EXCLUDED.frequency,
       recipient_user_ids = EXCLUDED.recipient_user_ids,
       attach_pdf = EXCLUDED.attach_pdf,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [cid, next.frequency, next.recipientUserIds, next.attachPdf, updatedBy]
  );

  return getAnalyticsReportPrefs(db, cid);
}

export { DEFAULT_PREFS as ANALYTICS_REPORT_DEFAULT_PREFS };
