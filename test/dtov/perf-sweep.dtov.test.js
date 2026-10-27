/**
 * DTOV: performance sweep (set/2026) — batched succession list, bounded HR Score batch,
 * single-query manager session hydrate, migration 138 indexes.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import {
  createCriticalRole,
  createSuccessionPlan,
  listCompanySuccessionPlans,
  listSuccessors,
} from '../../lib/development/succession-plans.js';
import { recalculateCompanyScores } from '../../lib/assessment/hr-score.js';
import { hydrateSessionPayload } from '../../lib/identity/session.js';
import { EMPLOYMENT_STATUS, SUCCESSION_READINESS } from '../../lib/domain-status.js';

const PERF_INDEXES = [
  'idx_manager_notifications_type_entity_created',
  'idx_ae_invites_company_candidate',
  'idx_candidate_invites_vacancy_candidate',
  'idx_ae_attempts_company_candidate_completed',
  'idx_climate_survey_responses_company_submitted',
  'idx_vacancy_candidates_company_stage',
  'idx_vacancy_candidates_vacancy_stage',
  'idx_assessment_pipeline_history_assessment_latest',
];

async function main() {
  const co = await query(
    `SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`
  );
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = co.rows[0].id;

  const idx = await query(`SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`, [PERF_INDEXES]);
  assert.deepEqual(idx.rows.map((r) => r.indexname).sort(), [...PERF_INDEXES].sort());

  const emps = await query(
    `SELECT id FROM candidates WHERE company_id = $1 AND employment_status = $2 ORDER BY id LIMIT 3`,
    [companyId, EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emps.rowCount >= 3, 'need 3 demo employees');
  const [a, b, c] = emps.rows.map((r) => Number(r.id));

  // Succession: batched list must match per-role list (order + cap semantics).
  const suffix = Date.now();
  const r1 = await createCriticalRole({ query }, { companyId, title: `Perf role A ${suffix}` });
  const r2 = await createCriticalRole({ query }, { companyId, title: `Perf role B ${suffix}` });
  assert.equal(r1.ok, true, r1.errorCode);
  assert.equal(r2.ok, true, r2.errorCode);
  const roleA = r1.role.id;
  const roleB = r2.role.id;
  for (const [roleId, successorId, readiness] of [
    [roleA, a, SUCCESSION_READINESS.DEVELOPING],
    [roleA, b, SUCCESSION_READINESS.NOW],
    [roleA, c, SUCCESSION_READINESS.READY],
    [roleB, c, SUCCESSION_READINESS.NOT_READY],
  ]) {
    const created = await createSuccessionPlan({ query }, { companyId, roleId, successorId, readiness });
    assert.equal(created.ok, true, created.errorCode);
  }
  const plans = await listCompanySuccessionPlans({ query }, { companyId });
  const planA = plans.find((p) => String(p.id) === String(roleA));
  const planB = plans.find((p) => String(p.id) === String(roleB));
  assert.ok(planA && planB, 'roles listed');
  const singleA = await listSuccessors({ query }, { companyId, roleId: roleA });
  assert.deepEqual(planA.successors.map((s) => s.id), singleA.map((s) => s.id));
  assert.equal(planA.successors.length, 3);
  assert.equal(planB.successors.length, 1);
  assert.ok(planA.successors.every((s) => String(s.roleId) === String(roleA)));
  assert.equal(planA.successors[0].readiness, SUCCESSION_READINESS.NOW, 'readiness order');
  assert.ok(planA.successors[0].successorName, 'successor name joined');

  // HR Score batch: bounded concurrency keeps one result per employee, in input order.
  const batch = await recalculateCompanyScores(companyId, { limit: 20 });
  assert.ok(batch.processed >= 3, `processed ${batch.processed}`);
  const ids = batch.results.map((r) => Number(r.candidateId));
  assert.deepEqual(ids, [...ids].sort((x, y) => x - y), 'results keep candidate id order');
  assert.ok(batch.results.every((r) => r.ok), JSON.stringify(batch.results.filter((r) => !r.ok)));

  // Session hydrate: modules come from the same users/companies row.
  const hr = await query(
    `SELECT u.id, u.session_version AS sv, c.enabled_modules AS modules
     FROM users u JOIN companies c ON c.id = u.company_id
     WHERE u.company_id = $1 AND u.email = 'hr@todos-os-dados.demo' AND u.deleted = FALSE LIMIT 1`,
    [companyId]
  );
  assert.ok(hr.rowCount, 'demo hr user missing');
  const userId = Number(hr.rows[0].id);
  const sv = Number(hr.rows[0].sv);
  const live = await hydrateSessionPayload({ userId, sv });
  assert.ok(live, 'live session hydrates');
  assert.equal(Number(live.companyId), Number(companyId));
  assert.ok(live.companyModules === null || Array.isArray(live.companyModules));
  assert.equal(await hydrateSessionPayload({ userId, sv: sv + 1 }), null, 'stale session_version rejected');

  console.log('perf-sweep.dtov.test.js OK');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
