import { query, withTransaction } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { billingPlan, LAUNCH_PRICE } from '../billing/catalog.js';
import { upsertCandidate } from '../ae/candidate-upsert.js';
import { persistCandidateHire, runCandidateHireEffects } from '../recruiting/hire.js';
import { lockPositionCompany } from '../people/org-positions.js';
import { parseEmployeeCsv } from './employee-csv-format.js';

async function existingEmails(db, companyId, rows) {
  const addresses = [...new Set(rows.flatMap(row => [row.email, row.personalEmail]).filter(Boolean))];
  const result = await db.query(
    `SELECT LOWER(email) AS email, LOWER(personal_email) AS personal
       FROM candidates
      WHERE company_id=$1 AND (LOWER(email)=ANY($2::text[]) OR LOWER(personal_email)=ANY($2::text[]))`,
    [companyId, addresses]
  );
  return new Set(result.rows.flatMap(row => [row.email, row.personal]).filter(Boolean));
}

async function companyCapacity(db, companyId) {
  const active = Number((await db.query(
    "SELECT COUNT(*)::int AS n FROM candidates WHERE company_id=$1 AND employment_status='employee'",
    [companyId]
  )).rows[0].n);
  const account = await db.query(
    `SELECT a.plan_key FROM company_billing_accounts a
       JOIN company_billing_terms t USING(company_id)
      WHERE a.company_id=$1 AND t.managed AND a.status IN ('active','trialing')
        AND a.period_end>now()
        AND a.livemode=(current_setting('grow.billing_mode',true)='live')
        AND current_setting('grow.billing_mode',true) IN ('test','live')
      LIMIT 1`,
    [companyId]
  );
  const key = account.rows[0]?.plan_key;
  const limit = (key === LAUNCH_PRICE.key ? LAUNCH_PRICE : billingPlan(key))?.maxEmployees ?? null;
  return { active, limit };
}

async function buildPreview(db, companyId, rows) {
  const [conflicts, capacity] = await Promise.all([
    existingEmails(db, companyId, rows),
    companyCapacity(db, companyId),
  ]);
  const annotated = rows.map(row => ({
    ...row,
    errors: [...row.errors, ...([row.email, row.personalEmail].some(address => address && conflicts.has(address))
      ? ['identidade_existente'] : [])],
  }));
  const invalid = annotated.filter(row => row.errors.length).length;
  return {
    rows: annotated,
    total: rows.length,
    invalid,
    capacity: { ...capacity, exceeded: capacity.limit != null && capacity.active + rows.length > capacity.limit },
    canImport: invalid === 0 && (capacity.limit == null || capacity.active + rows.length <= capacity.limit),
  };
}

export async function previewEmployeeCsv({ companyId, csv }) {
  const parsed = parseEmployeeCsv(csv);
  if (!parsed.ok) return parsed;
  return { ok: true, preview: await buildPreview({ query }, companyId, parsed.rows) };
}

/** One transaction: either every row becomes an employee, or no row does. */
export async function importEmployeeCsv({ companyId, csv, actorId, locale = 'pt-BR' }) {
  const parsed = parseEmployeeCsv(csv);
  if (!parsed.ok) return parsed;
  const outcome = await withTransaction(async db => {
    await lockPositionCompany(db, companyId);
    const preview = await buildPreview(db, companyId, parsed.rows);
    if (!preview.canImport) return { ok: false, preview };
    const created = [];
    for (const row of parsed.rows) {
      const candidate = await upsertCandidate({
        companyId, fullName: row.fullName, email: row.email,
        profile: { source: 'other' }, createdByUserId: actorId,
        db, rejectExisting: true,
      });
      if (!candidate.ok) {
        const error = new Error(candidate.errorCode || ERR.EMAIL_TAKEN);
        error.code = candidate.errorCode || ERR.EMAIL_TAKEN;
        throw error;
      }
      const hired = await persistCandidateHire(db, {
        candidateId: candidate.candidateId,
        vacancyId: null,
        startDate: row.startDate,
        actorId,
        personalEmail: row.personalEmail || null,
        inviteAccess: false,
        autoInvite: false,
        onboardingStages: [],
      });
      created.push({ line: row.line, candidateId: candidate.candidateId, ...hired });
    }
    return { ok: true, created };
  });
  if (!outcome.ok) return outcome;
  for (const person of outcome.created) {
    try {
      await runCandidateHireEffects({
        companyId, candidateId: person.candidateId, startDate: person.startDate,
        emailAccess: person.emailAccess, locale,
      });
    } catch (error) {
      console.error('[employee CSV import] post-commit effect failed', { code: error?.code || 'UNKNOWN' });
    }
  }
  return {
    ok: true,
    total: outcome.created.length,
    rows: outcome.created.map(({ line, candidateId }) => ({ line, candidateId, status: 'created' })),
  };
}
