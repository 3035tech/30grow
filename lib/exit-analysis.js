/**
 * Exit Analysis — registro de saída + agregação motivos × tipo/área (B-1006, Epic B-1000).
 * Insights: o que corrigir na seleção (M1) e gestão (M3/M4).
 */

import { asDb } from './ae/as-db.js';
import { withTransaction } from './db.js';
import { revokeEmployeeAccessForEmailChange } from './employee/employee-auth.js';
import { setEmployeeSessionVersionCache } from './employee/employee-session-revocation.js';
import { ERR } from './api-error-codes.js';
import { EMPLOYMENT_STATUS, EXIT_REASONS, EXIT_TYPES } from './domain-status.js';
import { toDateOnlyIso } from './format-display-date.js';
import { sanitizeRichTextHtml } from './sanitize-html.js';

const NOTES_MAX = 4000;
const LIST_CAP = 100;

const EXIT_TYPE_SET = new Set(EXIT_TYPES);
const EXIT_REASON_SET = new Set(EXIT_REASONS);

function normalizeStatus(raw, allowed, fallback) {
  const s = String(raw || '').trim().toLowerCase();
  return allowed.has(s) ? s : fallback;
}

function dateOrNull(raw) {
  return toDateOnlyIso(raw);
}

/** PG DATE → ISO date-only for JSON / UI (avoids Invalid Date in clients). */
function serializeExitRow(row) {
  if (!row) return row;
  return {
    ...row,
    exitDate: toDateOnlyIso(row.exitDate),
    rehiredAt: row.rehiredAt ? toDateOnlyIso(row.rehiredAt) : null,
  };
}

// ========================================
// EXIT RECORDS CRUD
// ========================================

/**
 * Create exit record (mark employee as alumni + store exit data).
 */
async function persistExitRecord(dbOrQuery, {
  companyId,
  candidateId,
  exitDate,
  exitType,
  exitReason,
  notes = '',
  createdByUserId = null,
  personalEmail = null,
}) {
  const db = asDb(dbOrQuery);
  const contactEmail = String(personalEmail || '').trim().toLowerCase();
  if (contactEmail && (contactEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail))) return { ok: false, errorCode: ERR.INVALID_EMAIL };
  
  // Validate candidate exists and is employee
  const cand = await db.query(
    `SELECT id, email, employment_status AS "employmentStatus"
     FROM candidates WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [candidateId, companyId]
  );
  if (cand.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  if (cand.rows[0].employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return { ok: false, errorCode: ERR.NOT_EMPLOYEE };
  }

  const safeExitDate = dateOrNull(exitDate) || new Date().toISOString().slice(0, 10);
  const safeType = normalizeStatus(exitType, EXIT_TYPE_SET, 'voluntary');
  const safeReason = normalizeStatus(exitReason, EXIT_REASON_SET, 'other');
  const safeNotes = sanitizeRichTextHtml(notes || '', NOTES_MAX) || '';

  try {
    // Insert exit record
    const res = await db.query(
      `INSERT INTO exit_records (
         candidate_id, company_id, exit_date, exit_type, exit_reason, notes, created_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, candidate_id AS "candidateId", company_id AS "companyId",
                 exit_date AS "exitDate", exit_type AS "exitType", exit_reason AS "exitReason",
                 notes, created_by_user_id AS "createdByUserId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [candidateId, companyId, safeExitDate, safeType, safeReason, safeNotes, createdByUserId || null]
    );

    // Update candidate employment_status to alumni
    await db.query(
      `UPDATE candidates SET employment_status = '${EMPLOYMENT_STATUS.ALUMNI}',
         personal_email = COALESCE(NULLIF($3, ''), personal_email),
         email = COALESCE(NULLIF($3, ''), NULLIF(LOWER(BTRIM(personal_email)), ''))
       WHERE id = $1 AND company_id = $2`,
      [candidateId, companyId, contactEmail]
    );

    const revoked = await revokeEmployeeAccessForEmailChange(db, { candidateId, companyId });
    return { ok: true, exitRecord: serializeExitRow(res.rows[0]), sessionVersion: revoked.sessionVersion, previousEmail: cand.rows[0].email };
  } catch (err) {
    throw err;
  }
}

/** Exit status, contact routing and access revocation commit together. */
export async function createExitRecord(dbOrQuery, opts) {
  try {
    const result = dbOrQuery == null
      ? await withTransaction(db => persistExitRecord(db, opts))
      : await persistExitRecord(dbOrQuery, opts);
    if (result.ok && result.sessionVersion != null) await setEmployeeSessionVersionCache(opts.candidateId, result.sessionVersion);
    const { sessionVersion, ...response } = result;
    return response;
  } catch (error) {
    if (error?.code === '23505') return { ok: false, errorCode: String(error.constraint || '').includes('email') ? ERR.EMAIL_TAKEN : ERR.EXIT_ALREADY_RECORDED };
    throw error;
  }
}

/**
 * Get exit record for a candidate.
 */
export async function getExitRecord(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT e.id, e.candidate_id AS "candidateId", e.company_id AS "companyId",
            e.exit_date AS "exitDate", e.exit_type AS "exitType", e.exit_reason AS "exitReason",
            e.notes, e.created_by_user_id AS "createdByUserId",
            e.created_at AS "createdAt", e.updated_at AS "updatedAt",
            e.rehired_at AS "rehiredAt",
            c.full_name AS "candidateName", c.email AS "candidateEmail"
     FROM exit_records e
     JOIN candidates c ON c.id = e.candidate_id AND c.company_id = e.company_id
     WHERE e.candidate_id = $1 AND e.company_id = $2
     ORDER BY (e.rehired_at IS NULL) DESC, e.exit_date DESC, e.id DESC
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (res.rowCount === 0) return null;
  return serializeExitRow(res.rows[0]);
}

/**
 * List exit records for a company (recent first).
 */
export async function listExitRecords(dbOrQuery, { companyId, limit = LIST_CAP }) {
  const db = asDb(dbOrQuery);
  const cap = Math.min(Math.max(1, Number(limit) || LIST_CAP), LIST_CAP);
  const res = await db.query(
    `SELECT e.id, e.candidate_id AS "candidateId", e.exit_date AS "exitDate",
            e.exit_type AS "exitType", e.exit_reason AS "exitReason", e.notes,
            c.full_name AS "candidateName", c.email AS "candidateEmail",
            c.employment_status AS "employmentStatus",
            e.created_at AS "createdAt", e.rehired_at AS "rehiredAt"
     FROM exit_records e
     JOIN candidates c ON c.id = e.candidate_id AND c.company_id = e.company_id
     WHERE e.company_id = $1
     ORDER BY e.exit_date DESC, e.id DESC
     LIMIT $2`,
    [companyId, cap]
  );
  return res.rows.map(serializeExitRow);
}

/**
 * Update exit record.
 */
export async function updateExitRecord(dbOrQuery, {
  companyId,
  exitRecordId,
  exitDate,
  exitType,
  exitReason,
  notes,
}) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT id, exit_date AS "exitDate", exit_type AS "exitType",
            exit_reason AS "exitReason", notes
     FROM exit_records WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [exitRecordId, companyId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.EXIT_RECORD_NOT_FOUND };
  const row = existing.rows[0];

  const nextDate = exitDate !== undefined ? dateOrNull(exitDate) : toDateOnlyIso(row.exitDate);
  const nextType = exitType !== undefined ? normalizeStatus(exitType, EXIT_TYPE_SET, row.exitType) : row.exitType;
  const nextReason = exitReason !== undefined ? normalizeStatus(exitReason, EXIT_REASON_SET, row.exitReason) : row.exitReason;
  const nextNotes = notes !== undefined
    ? (sanitizeRichTextHtml(notes || '', NOTES_MAX) || '')
    : row.notes;

  const res = await db.query(
    `UPDATE exit_records
     SET exit_date = $2, exit_type = $3, exit_reason = $4, notes = $5, updated_at = NOW()
     WHERE id = $1
     RETURNING id, candidate_id AS "candidateId", company_id AS "companyId",
               exit_date AS "exitDate", exit_type AS "exitType", exit_reason AS "exitReason",
               notes, created_by_user_id AS "createdByUserId",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [exitRecordId, nextDate, nextType, nextReason, nextNotes]
  );
  return { ok: true, exitRecord: serializeExitRow(res.rows[0]) };
}

/**
 * Delete a mistaken exit record. Only deleting the open exit restores the person to employee;
 * a past (already rehired) stint is history and never changes the current status.
 * Rehiring for real goes through `rehireEmployee` (lib/recruiting/hire.js), which keeps the record.
 */
export async function deleteExitRecord(dbOrQuery, { companyId, exitRecordId }) {
  const db = asDb(dbOrQuery);
  const existing = await db.query(
    `SELECT id, candidate_id AS "candidateId", rehired_at AS "rehiredAt"
     FROM exit_records WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [exitRecordId, companyId]
  );
  if (existing.rowCount === 0) return { ok: false, errorCode: ERR.EXIT_RECORD_NOT_FOUND };
  const { candidateId, rehiredAt } = existing.rows[0];

  const del = await db.query(
    `DELETE FROM exit_records WHERE id = $1 AND company_id = $2`,
    [exitRecordId, companyId]
  );
  if (del.rowCount === 0) return { ok: false, errorCode: ERR.EXIT_RECORD_NOT_FOUND };
  if (rehiredAt) return { ok: true, candidateId };

  await db.query(
    `UPDATE candidates
     SET employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
     WHERE id = $1 AND company_id = $2
       AND employment_status = '${EMPLOYMENT_STATUS.ALUMNI}'`,
    [candidateId, companyId]
  );

  return { ok: true, candidateId };
}

// ========================================
// AGGREGATIONS & INSIGHTS
// ========================================

/**
 * Aggregate exit reasons by type (voluntary/involuntary) and reason.
 */
export async function getExitReasonAggregation(dbOrQuery, { companyId, minExits = 1 }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT e.exit_type AS "exitType", e.exit_reason AS "exitReason",
            COUNT(*)::int AS "count"
     FROM exit_records e
     WHERE e.company_id = $1
     GROUP BY e.exit_type, e.exit_reason
     HAVING COUNT(*) >= $2
     ORDER BY COUNT(*) DESC, e.exit_type, e.exit_reason`,
    [companyId, minExits]
  );
  return res.rows;
}

/**
 * Aggregate exits by T1-T9 type (cross-tab: exit_reason × top_type).
 */
export async function getExitsByTypeProfile(dbOrQuery, { companyId, minExits = 1 }) {
  const db = asDb(dbOrQuery);
  const res = await db.query(
    `SELECT a.top_type AS "topType", e.exit_reason AS "exitReason",
            COUNT(*)::int AS "count"
     FROM exit_records e
     JOIN candidates c ON c.id = e.candidate_id AND c.company_id = e.company_id
     LEFT JOIN LATERAL (
       SELECT top_type FROM assessments
       WHERE candidate_id = c.id AND top_type IS NOT NULL
       ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE e.company_id = $1 AND a.top_type IS NOT NULL
     GROUP BY a.top_type, e.exit_reason
     HAVING COUNT(*) >= $2
     ORDER BY COUNT(*) DESC, a.top_type, e.exit_reason`,
    [companyId, minExits]
  );
  return res.rows;
}

/**
 * Get exit insights: patterns that suggest fixes in recruitment (M1) or management (M3/M4).
 */
export async function getExitInsights(dbOrQuery, { companyId }) {
  const db = asDb(dbOrQuery);
  
  const [reasonAgg, typeAgg, totalRes] = await Promise.all([
    getExitReasonAggregation(db, { companyId, minExits: 1 }),
    getExitsByTypeProfile(db, { companyId, minExits: 1 }),
    db.query(
      `SELECT COUNT(*)::int AS "total" FROM exit_records WHERE company_id = $1`,
      [companyId]
    ),
  ]);

  const total = totalRes.rows[0]?.total || 0;
  if (total === 0) return { insights: [], total: 0 };

  const insights = [];

  // Insight 1: High voluntary exits for better_offer/compensation/benefits → M1
  const compReasons = reasonAgg.filter((r) =>
    r.exitType === 'voluntary'
    && ['better_offer', 'compensation', 'benefits'].includes(r.exitReason)
  );
  const compCount = compReasons.reduce((sum, r) => sum + r.count, 0);
  if (compCount / total > 0.3) {
    insights.push({
      category: 'recruitment',
      signal: 'compensation',
      severity: 'high',
      description: 'Alto volume de saídas por compensação/proposta melhor/benefícios',
      suggestion: 'Revisar faixas salariais e pacote de benefícios na seleção',
      count: compCount,
      percentage: Math.round((compCount / total) * 100),
    });
  }

  // Insight 2: High culture_fit exits → M1 (recruitment: assessment not filtering well)
  const cultureFit = reasonAgg.find((r) => r.exitReason === 'culture_fit');
  if (cultureFit && cultureFit.count / total > 0.2) {
    insights.push({
      category: 'recruitment',
      signal: 'culture_fit',
      severity: 'medium',
      description: 'Saídas por fit cultural sugerem falha na triagem',
      suggestion: 'Reforçar avaliação de fit cultural e rubrica T1-T9 na seleção',
      count: cultureFit.count,
      percentage: Math.round((cultureFit.count / total) * 100),
    });
  }

  // Insight 3: Manager / recognition / harassment → M3/M4
  const managerBucket = reasonAgg.filter((r) =>
    ['manager_relationship', 'recognition', 'harassment'].includes(r.exitReason)
  );
  const managerCount = managerBucket.reduce((sum, r) => sum + r.count, 0);
  if (managerCount / total > 0.15) {
    insights.push({
      category: 'management',
      signal: 'manager_relationship',
      severity: 'high',
      description: 'Relacionamento com gestor, reconhecimento ou clima hostil recorrente',
      suggestion: 'Investir em 1:1, feedback contínuo, liderança e canais seguros de denúncia',
      count: managerCount,
      percentage: Math.round((managerCount / total) * 100),
    });
  }

  // Insight 4: Career / challenge / tools → M3/M4
  const careerBucket = reasonAgg.filter((r) =>
    ['career_growth', 'lack_of_challenge', 'tools_process'].includes(r.exitReason)
  );
  const careerCount = careerBucket.reduce((sum, r) => sum + r.count, 0);
  if (careerCount / total > 0.2) {
    insights.push({
      category: 'management',
      signal: 'career_growth',
      severity: 'medium',
      description: 'Crescimento, desafio ou ferramentas/processos como motivo comum',
      suggestion: 'Estruturar PDI, sucessão, plano de carreira e melhoria de processos',
      count: careerCount,
      percentage: Math.round((careerCount / total) * 100),
    });
  }

  // Insight 5: Burnout / workload / schedule / targets → M3/M4
  const loadBucket = reasonAgg.filter((r) =>
    ['burnout', 'workload', 'schedule', 'targets_pressure', 'client_pressure'].includes(r.exitReason)
  );
  const loadCount = loadBucket.reduce((sum, r) => sum + r.count, 0);
  if (loadCount / total > 0.2) {
    insights.push({
      category: 'management',
      signal: 'workload',
      severity: 'high',
      description: 'Sobrecarga, escala ou pressão por metas/clientes recorrente',
      suggestion: 'Revisar dimensionamento, turnos, metas e suporte operacional',
      count: loadCount,
      percentage: Math.round((loadCount / total) * 100),
    });
  }

  // Insight 6: Involuntary performance exits > 30% → M1 or M3
  const perfExits = reasonAgg.filter((r) => r.exitType === 'involuntary' && r.exitReason === 'performance');
  const perfCount = perfExits.reduce((sum, r) => sum + r.count, 0);
  if (perfCount / total > 0.3) {
    insights.push({
      category: 'recruitment',
      signal: 'performance',
      severity: 'high',
      description: 'Alto volume de dispensas por desempenho',
      suggestion: 'Revisar critérios de seleção, onboarding e suporte inicial',
      count: perfCount,
      percentage: Math.round((perfCount / total) * 100),
    });
  }

  return { insights, total, reasonAgg, typeAgg };
}

export const EXIT_ANALYSIS_CAPS = {
  LIST_CAP,
  EXIT_TYPES,
  EXIT_REASONS,
};

export { EXIT_TYPES, EXIT_REASONS };
