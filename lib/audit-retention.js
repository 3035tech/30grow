// Security/access events retain the longer approved window; policy decisions remain as evidence.
const SECURITY_ACTION = '(^|[._])(auth|login|logout|password|session|2fa|totp|security|access|email_change|user)([._]|$)';
export const AUDIT_RETENTION_BATCH_SIZE = 500;
const MAX_BATCHES = 10;

export async function purgeAuditLog(db, { dryRun = true, afterCompanyId = 0 } = {}) {
  if (!Number.isSafeInteger(afterCompanyId) || afterCompanyId < 0) throw new Error('Invalid audit retention cursor');
  const policies = await db.query('SELECT company_id AS "companyId" FROM audit_retention_policies WHERE company_id > $1 ORDER BY company_id LIMIT 50', [afterCompanyId]);
  let remainingBatches = MAX_BATCHES;
  const totals = { dryRun, eligible: 0, deleted: 0, heldCompanies: 0, truncated: false, nextCompanyId: afterCompanyId };
  for (const { companyId } of policies.rows) {
    const result = await db.withTransaction(async (client) => {
      // Serializes with updates/holds. A hold applied first wins; a purge already committed cannot be undone.
      const policy = await client.query('SELECT * FROM audit_retention_policies WHERE company_id = $1 FOR UPDATE', [companyId]);
      const current = policy.rows[0];
      if (!current || current.legal_hold) return { held: Boolean(current?.legal_hold), eligible: 0, deleted: 0, truncated: false };
      const args = [companyId, current.retention_days, current.security_retention_days, SECURITY_ACTION];
      const where = `company_id = $1 AND action NOT LIKE 'audit.retention.%'
        AND created_at < NOW() - (CASE WHEN action ~* $4 THEN $3::int ELSE $2::int END * INTERVAL '1 day')`;
      if (dryRun) {
        const count = await client.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE ${where}`, args);
        return { eligible: count.rows[0].n, deleted: 0, truncated: false };
      }
      let deleted = 0;
      while (remainingBatches > 0) {
        remainingBatches--;
        const removal = await client.query(`DELETE FROM audit_log WHERE id IN (
          SELECT id FROM audit_log WHERE ${where} ORDER BY created_at, id LIMIT $5 FOR UPDATE SKIP LOCKED
        )`, [...args, AUDIT_RETENTION_BATCH_SIZE]);
        deleted += removal.rowCount;
        if (removal.rowCount < AUDIT_RETENTION_BATCH_SIZE) break;
      }
      const remaining = await client.query(`SELECT EXISTS(SELECT 1 FROM audit_log WHERE ${where}) AS remaining`, args);
      return { eligible: deleted, deleted, truncated: Boolean(remaining.rows[0].remaining) };
    });
    totals.eligible += result.eligible;
    totals.deleted += result.deleted;
    totals.heldCompanies += result.held ? 1 : 0;
    totals.truncated ||= result.truncated;
    if (result.truncated) break;
    totals.nextCompanyId = Number(companyId);
    if (!dryRun && remainingBatches === 0) { totals.truncated = true; break; }
  }
  // A bounded sweep; do not silently imply all tenants were processed.
  if (policies.rows.length === 50) totals.truncated = true;
  return totals;
}
