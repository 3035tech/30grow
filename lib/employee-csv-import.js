import { parseEmployeeCsv } from './employee-csv.js';
import { query, withTransaction } from './db.js';
import { persistCandidateHire, runCandidateHireEffects } from './hire.js';
import { lockPositionCompany } from './people/org-positions.js';

export async function previewEmployeeCsv(csv, companyId, dbQuery = query) {
  const rows = parseEmployeeCsv(csv);
  const emails = rows.flatMap(row => [row.email, row.personalEmail]).filter(Boolean);
  const existing = await dbQuery(`SELECT LOWER(email) AS email, LOWER(personal_email) AS "personalEmail" FROM candidates
    WHERE company_id=$1 AND (LOWER(email)=ANY($2::text[]) OR LOWER(personal_email)=ANY($2::text[]))`, [companyId, emails]);
  const used = new Set(existing.rows.flatMap(row => [row.email, row.personalEmail]).filter(Boolean));
  return rows.map(row => ({ ...row, errors: used.has(row.email) || (row.personalEmail && used.has(row.personalEmail)) ? [...row.errors, 'CSV_EXISTING'] : row.errors }));
}

export async function importEmployeeCsv({ csv, companyId, actorId, locale }) {
  // Re-read and validate on confirmation; a browser preview is never authorization.
  const preview = await previewEmployeeCsv(csv, companyId);
  const rows = [];
  for (const row of preview) {
    if (row.errors.length) { rows.push(row); continue; }
    try {
      // Independent transactions give explicit per-row results and safe retry after a partial batch.
      const result = await withTransaction(async db => {
        await lockPositionCompany(db, companyId);
        const exists = await db.query(`SELECT id FROM candidates WHERE company_id=$1 AND
          (LOWER(email)=ANY($2::text[]) OR LOWER(personal_email)=ANY($2::text[])) LIMIT 1`, [companyId, [row.email, row.personalEmail].filter(Boolean)]);
        if (exists.rowCount) return null;
        const inserted = await db.query(`INSERT INTO candidates (company_id,full_name,email,personal_email,created_by_user_id)
          VALUES ($1,$2,$3,NULLIF($4,''),$5) ON CONFLICT DO NOTHING RETURNING id`, [companyId, row.fullName, row.email, row.personalEmail, actorId]);
        if (!inserted.rowCount) return null;
        const candidateId = inserted.rows[0].id;
        const hired = await persistCandidateHire(db, { candidateId, startDate: row.startDate, actorId, onboardingStages: [], autoInvite: false });
        return { candidateId, ...hired };
      });
      if (!result) { rows.push({ ...row, errors: ['CSV_EXISTING'] }); continue; }
      // Dispensable onboarding stages and no invite. Uses the normal hire effects.
      await runCandidateHireEffects({ ...result, locale }).catch(() => {});
      rows.push({ ...row, candidateId: result.candidateId, errors: [] });
    } catch {
      // Avoid logging CSV PII or returning database internals.
      rows.push({ ...row, errors: ['CSV_FAILED'] });
    }
  }
  return { ok: true, rows };
}
