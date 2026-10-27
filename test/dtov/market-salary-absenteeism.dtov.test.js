/**
 * DTOV proof — absenteeism pulse + market salary band compare (B-2711).
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import {
  DP_LEAVE_STATUS,
  DP_LEAVE_TYPE,
  EMPLOYMENT_STATUS,
} from '../../lib/domain-status.js';
import {
  createLeaveRequest,
  getAbsenteeismPulse,
  updateLeaveRequest,
} from '../../lib/people/employee-dp.js';
import {
  compareAmountToMarketBand,
  createCompensationEvent,
  getCompensationMarketContext,
  getCompensationMarketPulse,
  setCandidateJobRole,
} from '../../lib/people/employee-compensation.js';
import { createJobRole } from '../../lib/recruiting/job-roles.js';

async function main() {
  assert.equal(compareAmountToMarketBand('5000.00', '6000.00', '9000.00').status, 'below');
  assert.equal(compareAmountToMarketBand('7000.00', '6000.00', '9000.00').status, 'in_band');
  assert.equal(compareAmountToMarketBand('9500.00', '6000.00', '9000.00').status, 'above');
  assert.equal(compareAmountToMarketBand(null, '6000.00', '9000.00').status, 'no_salary');
  assert.equal(compareAmountToMarketBand('7000.00', null, null).status, 'no_band');

  const emp = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId"
     FROM candidates c
     WHERE c.employment_status = $1
       AND c.email ILIKE '%@todos-os-dados.demo'
     ORDER BY c.id ASC
     LIMIT 1`,
    [EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emp.rowCount > 0, 'need demo employee');
  const { candidateId, companyId } = emp.rows[0];

  const hr = await query(
    `SELECT u.id AS "userId"
     FROM users u
     WHERE u.email = 'hr@todos-os-dados.demo' AND u.deleted = FALSE
     LIMIT 1`
  );
  assert.ok(hr.rowCount > 0, 'need demo HR');
  const userId = hr.rows[0].userId;

  const roleName = `DTOV Market Role ${Date.now()}`;
  const role = await createJobRole({
    companyId,
    name: roleName,
    description: 'dtov',
    rubric: { T3: 40, T6: 30 },
    marketSalaryMin: '8000.00',
    marketSalaryMax: '12000.00',
  });
  assert.ok(role?.id);

  const linked = await setCandidateJobRole(
    { query },
    { companyId, candidateId, jobRoleId: role.id }
  );
  assert.equal(linked.ok, true, linked.errorCode);
  assert.equal(linked.jobRoleId, Number(role.id));

  await createCompensationEvent(
    { query },
    {
      companyId,
      candidateId,
      eventType: 'adjustment',
      amount: '5000.00',
      effectiveDate: new Date().toISOString().slice(0, 10),
      notes: '',
      createdByUserId: userId,
    }
  );

  const ctx = await getCompensationMarketContext({ query }, { companyId, candidateId });
  assert.equal(ctx.ok, true);
  assert.equal(ctx.compare.status, 'below');

  const marketPulse = await getCompensationMarketPulse({ query }, { companyId });
  assert.ok(
    (marketPulse.items || []).some((i) => Number(i.candidateId) === Number(candidateId)),
    'market pulse should list below-band employee'
  );

  const today = new Date();
  const d1 = new Date(today);
  d1.setDate(d1.getDate() - 10);
  const d2 = new Date(today);
  d2.setDate(d2.getDate() - 3);
  const iso = (d) => d.toISOString().slice(0, 10);

  const leave1 = await createLeaveRequest(
    { query },
    {
      companyId,
      candidateId,
      leaveType: DP_LEAVE_TYPE.SICK,
      startsOn: iso(d1),
      endsOn: iso(d1),
      reason: 'dtov sick 1',
      requestedBy: 'manager',
      userId,
    }
  );
  assert.equal(leave1.ok, true, leave1.errorCode);
  await updateLeaveRequest(
    { query },
    {
      companyId,
      id: leave1.item.id,
      status: DP_LEAVE_STATUS.APPROVED,
      userId,
    }
  );

  const leave2 = await createLeaveRequest(
    { query },
    {
      companyId,
      candidateId,
      leaveType: DP_LEAVE_TYPE.SICK,
      startsOn: iso(d2),
      endsOn: iso(d2),
      reason: 'dtov sick 2',
      requestedBy: 'manager',
      userId,
    }
  );
  assert.equal(leave2.ok, true, leave2.errorCode);
  await updateLeaveRequest(
    { query },
    {
      companyId,
      id: leave2.item.id,
      status: DP_LEAVE_STATUS.TAKEN,
      userId,
    }
  );

  const abs = await getAbsenteeismPulse({ query }, { companyId });
  assert.ok(
    (abs.items || []).some((i) => Number(i.candidateId) === Number(candidateId)),
    'absenteeism pulse should list elevated sick leave'
  );

  console.log('market-salary-absenteeism.dtov.test.js: ok');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
