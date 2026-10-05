/**
 * DTOV proof — onboarding wizard events (idempotent) + super-admin funnel (MVP-08).
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import { ONBOARDING_EVENT, ONBOARDING_STEP } from '../../lib/domain-status.js';
import { getOnboardingFunnel, recordOnboardingEvent } from '../../lib/onboarding-funnel.js';

async function main() {
  const hr = await query(
    `SELECT u.id AS "userId", u.company_id AS "companyId", u.onboarding_completed AS done
     FROM users u
     WHERE u.email = 'hr@todos-os-dados.demo' AND u.deleted = FALSE
     LIMIT 1`
  );
  assert.ok(hr.rowCount > 0, 'need demo HR user');
  const { userId, companyId, done } = hr.rows[0];
  const db = { query };

  const events = [
    [ONBOARDING_STEP.WELCOME, ONBOARDING_EVENT.VIEWED],
    [ONBOARDING_STEP.WELCOME, ONBOARDING_EVENT.COMPLETED],
    [ONBOARDING_STEP.OBJECTIVE, ONBOARDING_EVENT.VIEWED],
    [ONBOARDING_STEP.OBJECTIVE, ONBOARDING_EVENT.COMPLETED, 'recruiting'],
    [ONBOARDING_STEP.MODULES, ONBOARDING_EVENT.VIEWED],
  ];
  const countEvents = async () =>
    (await query(`SELECT COUNT(*)::int AS n FROM onboarding_events WHERE user_id = $1`, [userId])).rows[0].n;
  const before = await countEvents();
  const counts = [];
  for (let round = 0; round < 2; round += 1) {
    for (const [step, event, objective] of events) {
      const r = await recordOnboardingEvent(db, { companyId, userId, step, event, objective });
      assert.equal(r.ok, true, r.errorCode);
    }
    counts.push(await countEvents());
  }
  assert.ok(counts[0] - before <= events.length);
  assert.equal(counts[1], counts[0], 'retries do not duplicate events');

  await assert.rejects(
    query(
      `INSERT INTO onboarding_events (company_id, user_id, step, event) VALUES ($1, $2, 'payroll', 'viewed')`,
      [companyId, userId]
    ),
    /onboarding_events_step_chk/
  );

  const funnel = await getOnboardingFunnel({ query }, { days: 30 });
  assert.equal(funnel.days, 30);
  assert.ok(funnel.startedUsers >= 1);
  const byStep = Object.fromEntries(funnel.steps.map((s) => [s.step, s]));
  assert.equal(funnel.steps.length, 6);
  assert.ok(byStep.welcome.viewed >= 1);
  assert.ok(byStep.objective.completed >= 1);
  assert.ok(byStep.modules.viewed >= 1);
  assert.equal(byStep.welcome.reachPct, 100);
  const abandonedTotal = funnel.steps.reduce((sum, s) => sum + s.abandoned, 0);
  if (done) assert.ok(funnel.finishedUsers >= 1);
  else assert.ok(abandonedTotal >= 1, 'unfinished manager is counted as stopped');
  assert.ok((funnel.objectives.recruiting || 0) >= 1);

  const company = funnel.companies.find((c) => Number(c.companyId) === Number(companyId));
  assert.ok(company, 'company listed in funnel');
  const order = Object.values(ONBOARDING_STEP);
  assert.ok(order.indexOf(company.furthestStep) >= order.indexOf(ONBOARDING_STEP.MODULES), 'furthest step tracked');
  const startedMs = new Date(company.startedAt).getTime();
  for (const at of [company.firstVacancyAt, company.firstAnalysisAt]) {
    if (at) assert.ok(new Date(at).getTime() >= startedMs, 'first value never predates the wizard');
  }
  const seeded = await query(
    `SELECT MIN(created_at) AS at FROM vacancies WHERE company_id = $1 AND deleted = FALSE`,
    [companyId]
  );
  const seededAt = seeded.rows[0]?.at;
  if (seededAt && new Date(seededAt).getTime() < startedMs) {
    assert.notEqual(
      company.firstVacancyAt && new Date(company.firstVacancyAt).getTime(),
      new Date(seededAt).getTime(),
      'seeded vacancy before the wizard is not time-to-value'
    );
  }
  if (company.hoursToFirstValue != null) assert.ok(company.hoursToFirstValue >= 0);
  assert.ok(funnel.firstValue.withAny <= funnel.firstValue.companies);
  assert.ok(funnel.companies.length <= funnel.companyCap);

  const wide = await getOnboardingFunnel({ query }, { days: 7 });
  assert.equal(wide.days, 30, 'unsupported period falls back to 30');

  console.log('onboarding-funnel.dtov.test.js OK');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
