import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dtovEnv, assertDtovTarget } from './harness.js';
const env = dtovEnv();
assertDtovTarget(env);
Object.assign(process.env, env);
const { query, pool, withTransaction } = await import('../../lib/db.js');
const {
  saveOrgPosition,
  changeOrgPosition,
  manageOrgAssignment,
  releaseOrgPosition,
  linkOrgPositionVacancy,
  listOrgPositions,
  getOrgPositionHistory,
} = await import('../../lib/people/org-positions.js');
const { persistCandidateHire, markCandidateHired } = await import('../../lib/hire.js');
const { assignOrgUnit, saveOrgUnit } = await import('../../lib/people/org-units.js');
const { updateJobRole } = await import('../../lib/job-roles.js');
const companies = [];
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
try {
  const before = (await query('SELECT id,org_unit_id,job_role_id FROM candidates ORDER BY id'))
    .rows;
  const migration = await readFile(
    new URL('../../migrations/159_organizational_positions.sql', import.meta.url),
    'utf8',
  );
  await query(migration);
  await query(migration);
  assert.deepEqual(
    (await query('SELECT id,org_unit_id,job_role_id FROM candidates ORDER BY id')).rows,
    before,
  );
  checks++;
  for (let i = 0; i < 2; i++)
    companies.push(
      Number(
        (
          await query(
            "INSERT INTO companies(name,slug) VALUES('Headcount regression',$1) RETURNING id",
            [`headcount-${Date.now()}-${i}`],
          )
        ).rows[0].id,
      ),
    );
  const [companyId, foreignCompany] = companies;
  const actorId = Number(
    (
      await query(
        "INSERT INTO users(company_id,email,password_hash,role) VALUES($1,$2,'unusable','hr') RETURNING id",
        [companyId, `hc-${Date.now()}@dtov.invalid`],
      )
    ).rows[0].id,
  );
  const unitId = Number(
    (
      await query(
        "INSERT INTO org_units(company_id,name,unit_type) VALUES($1,'Engineering','department') RETURNING id",
        [companyId],
      )
    ).rows[0].id,
  );
  const roleId = Number(
    (
      await query("INSERT INTO job_roles(company_id,name) VALUES($1,'Engineer') RETURNING id", [
        companyId,
      ])
    ).rows[0].id,
  );
  const foreignUnit = Number(
    (
      await query("INSERT INTO org_units(company_id,name) VALUES($1,'Private unit') RETURNING id", [
        foreignCompany,
      ])
    ).rows[0].id,
  );
  const employee = async (name) =>
    Number(
      (
        await query(
          "INSERT INTO candidates(company_id,full_name,email,employment_status) VALUES($1,$2,$3,'employee') RETURNING id",
          [companyId, name, `${name}-${Date.now()}@dtov.invalid`],
        )
      ).rows[0].id,
    );
  const employeeA = await employee('EmployeeA'),
    employeeB = await employee('EmployeeB');
  const draft = {
    companyId,
    actorId,
    code: 'ENG-001',
    title: 'Engineer seat',
    orgUnitId: unitId,
    jobRoleId: roleId,
    fte: 1,
    effectiveFrom: '2020-01-01',
  };
  const create = async (code) => {
    const result = await saveOrgPosition({ ...draft, code });
    assert.ok(result.ok, JSON.stringify(result));
    return Number(result.id);
  };
  const approve = async (id) =>
    changeOrgPosition({
      companyId,
      id,
      version: (await query('SELECT version FROM org_positions WHERE id=$1', [id])).rows[0].version,
      status: 'approved',
      actorId,
    });
  const positionId = await create('ENG-001');
  check(
    (await saveOrgPosition({ ...draft, code: ' eng-001 ' })).errorCode === 'POSITION_DUPLICATE',
    'unique normalized code',
  );
  check(
    (await saveOrgPosition({ ...draft, code: 'PRIVATE', orgUnitId: foreignUnit })).errorCode ===
      'POSITION_REFERENCE',
    'foreign reference blocked',
  );
  await assert.rejects(
    query('UPDATE org_positions SET org_unit_id=$1 WHERE id=$2', [foreignUnit, positionId]),
    { code: '23503' },
  );
  checks++;
  check(
    (
      await manageOrgAssignment({
        companyId,
        positionId,
        candidateId: employeeA,
        startedOn: '2026-01-01',
        reason: 'Allocation',
        actorId,
      })
    ).ok === false,
    'unapproved position cannot be occupied',
  );
  check((await approve(positionId)).ok, 'approval records headcount');
  check(
    (await changeOrgPosition({ companyId, id: positionId, version: 1, status: 'frozen', actorId }))
      .errorCode === 'POSITION_CONFLICT',
    'stale plan blocked',
  );
  const race = await Promise.all(
    [employeeA, employeeB].map((candidateId) =>
      manageOrgAssignment({
        companyId,
        positionId,
        candidateId,
        startedOn: '2026-01-01',
        reason: 'Allocation race',
        actorId,
      }),
    ),
  );
  check(race.filter((r) => r.ok).length === 1, 'only one concurrent occupant');
  const occupation = (
    await query(
      'SELECT candidate_id FROM org_position_assignments WHERE position_id=$1 AND ended_on IS NULL',
      [positionId],
    )
  ).rows[0];
  const occupant = Number(occupation.candidate_id);
  check(
    (await query('SELECT org_unit_id,job_role_id FROM candidates WHERE id=$1', [occupant])).rows[0]
      .org_unit_id === unitId,
    'allocation synchronizes legacy profile',
  );
  check(
    (await assignOrgUnit({ companyId, candidateId: occupant, orgUnitId: null })).errorCode ===
      'POSITION_IN_USE',
    'legacy unit editor cannot split position',
  );
  await assert.rejects(query('UPDATE candidates SET org_unit_id=NULL WHERE id=$1', [occupant]), {
    code: '23514',
  });
  checks++;
  await assert.rejects(
    updateJobRole(roleId, { active: false }),
    (error) => error.code === 'POSITION_IN_USE',
  );
  checks++;
  check(
    (await saveOrgUnit({ companyId, id: unitId, active: false })).errorCode === 'ORG_UNIT_IN_USE',
    'unit in use cannot be archived',
  );
  check(
    (await changeOrgPosition({ companyId, id: positionId, version: 3, status: 'frozen', actorId }))
      .errorCode === 'POSITION_IN_USE',
    'occupied position cannot be frozen',
  );
  const next = await create('ENG-002');
  await approve(next);
  check(
    (
      await manageOrgAssignment({
        companyId,
        positionId: next,
        candidateId: occupant,
        startedOn: '2026-02-01',
        reason: 'Transfer',
        actorId,
      })
    ).ok,
    'transfer succeeds atomically',
  );
  check(
    (
      await releaseOrgPosition({
        companyId,
        positionId: next,
        assignmentId: 999999999,
        endedOn: '2026-03-01',
        reason: 'Stale dialog',
        actorId,
      })
    ).errorCode === 'POSITION_CONFLICT',
    'stale release cannot close another occupation',
  );
  check(
    (
      await manageOrgAssignment({
        companyId,
        positionId,
        candidateId: occupant === employeeA ? employeeB : employeeA,
        startedOn: '2026-01-15',
        reason: 'Backdated overlap',
        actorId,
      })
    ).errorCode === 'INVALID_DATE',
    'historical position intervals cannot overlap',
  );
  const history = await getOrgPositionHistory(companyId, positionId);
  check(history.items[0].endedOn === '2026-02-01', 'old occupation retained');
  check(
    (
      await releaseOrgPosition({
        companyId,
        positionId: next,
        assignmentId: Number(
          (
            await query(
              'SELECT id FROM org_position_assignments WHERE position_id=$1 AND ended_on IS NULL',
              [next],
            )
          ).rows[0].id,
        ),
        endedOn: '2026-03-01',
        reason: 'Correction',
        actorId,
      })
    ).ok,
    'release preserves employee',
  );
  check(
    (await query('SELECT employment_status FROM candidates WHERE id=$1', [occupant])).rows[0]
      .employment_status === 'employee',
    'release is not dismissal',
  );
  const vacancyId = Number(
    (
      await query(
        "INSERT INTO vacancies(company_id,title,slug,job_role_id,positions_count) VALUES($1,'Engineer vacancy',$2,$3,1) RETURNING id",
        [companyId, `hc-${Date.now()}`, roleId],
      )
    ).rows[0].id,
  );
  check(
    (await linkOrgPositionVacancy({ companyId, positionId, vacancyId, actorId })).ok,
    'link vacancy to approved seat',
  );
  const oldRecruitment = Number(
    (
      await query(
        'SELECT id FROM org_position_recruitments WHERE position_id=$1 AND ended_at IS NULL',
        [positionId],
      )
    ).rows[0].id,
  );
  check(
    (
      await linkOrgPositionVacancy({
        companyId,
        positionId,
        vacancyId: null,
        recruitmentId: oldRecruitment,
        actorId,
      })
    ).ok,
    'unlink exact recruitment',
  );
  check(
    (await linkOrgPositionVacancy({ companyId, positionId, vacancyId, actorId })).ok,
    'withdrawn link does not consume capacity',
  );
  await linkOrgPositionVacancy({
    companyId,
    positionId,
    vacancyId: null,
    recruitmentId: oldRecruitment,
    actorId,
  });
  check(
    (
      await query(
        'SELECT id FROM org_position_recruitments WHERE position_id=$1 AND ended_at IS NULL',
        [positionId],
      )
    ).rowCount === 1,
    'stale unlink preserves replacement recruitment',
  );

  check(
    (await linkOrgPositionVacancy({ companyId, positionId: next, vacancyId, actorId }))
      .errorCode === 'POSITION_VACANCY_FULL',
    'vacancy capacity enforced',
  );
  await query('UPDATE vacancies SET positions_count=2 WHERE id=$1', [vacancyId]);
  check(
    (await linkOrgPositionVacancy({ companyId, positionId: next, vacancyId, actorId })).ok,
    'capacity can be expanded before linking',
  );
  await query('UPDATE vacancies SET positions_count=1 WHERE id=$1', [vacancyId]);
  const candidate = async (name) =>
    Number(
      (
        await query(
          'INSERT INTO candidates(company_id,full_name,email) VALUES($1,$2,$3) RETURNING id',
          [companyId, name, `${name}-${Date.now()}@dtov.invalid`],
        )
      ).rows[0].id,
    );
  const hireA = await candidate('HireA'),
    hireB = await candidate('HireB');
  for (const id of [hireA, hireB])
    await query(
      'INSERT INTO vacancy_candidates(company_id,vacancy_id,candidate_id) VALUES($1,$2,$3)',
      [companyId, vacancyId, id],
    );
  const hire = (pid) =>
    withTransaction(async (db) => {
      await db.query(
        "UPDATE vacancy_candidates SET pipeline_stage='hired' WHERE vacancy_id=$1 AND candidate_id=$2",
        [vacancyId, pid],
      );
      return persistCandidateHire(db, {
        candidateId: pid,
        vacancyId,
        startDate: '2026-04-01',
        actorId,
      });
    });
  const hiring = await Promise.allSettled([hire(hireA), hire(hireB)]);
  console.log(
    'Concurrent hire outcomes',
    hiring.map((r) => ({ status: r.status, code: r.reason?.code, message: r.reason?.message })),
  );
  check(
    hiring.filter((r) => r.status === 'fulfilled').length === 1,
    'concurrent hires fill only one position',
  );
  const hiredId = hiring[0].status === 'fulfilled' ? hireA : hireB,
    rejectedId = hiredId === hireA ? hireB : hireA;
  check(
    (
      await query(
        'SELECT pipeline_stage FROM vacancy_candidates WHERE vacancy_id=$1 AND candidate_id=$2',
        [vacancyId, rejectedId],
      )
    ).rows[0].pipeline_stage !== 'hired',
    'failed hire rolls pipeline back',
  );
  check(
    (await query('SELECT employment_status FROM candidates WHERE id=$1', [rejectedId])).rows[0]
      .employment_status === 'candidate',
    'failed hire preserves candidate',
  );
  await hire(hiredId);
  check(
    Number(
      (
        await query(
          'SELECT COUNT(*) AS n FROM org_position_assignments WHERE position_id=$1 AND ended_on IS NULL',
          [positionId],
        )
      ).rows[0].n,
    ) === 1,
    'hire retry idempotent',
  );
  const linked = await listOrgPositions(companyId, { vacancyId });
  check(
    linked.items.length === 2 && linked.items.some((item) => item.filledAssignmentId),
    'filled position remains visible on vacancy',
  );
  await query("UPDATE candidates SET employment_status='alumni' WHERE id=$1", [hiredId]);
  check(
    !(
      await query(
        'SELECT id FROM org_position_assignments WHERE candidate_id=$1 AND ended_on IS NULL',
        [hiredId],
      )
    ).rowCount,
    'exit automatically releases seat',
  );
  check(
    (await getOrgPositionHistory(companyId, positionId)).items.length === 2,
    'exit retains all occupations',
  );
  const legacy = await candidate('Legacy');
  await markCandidateHired({ candidateId: legacy, startDate: '2026-01-01' });
  check(
    (await query('SELECT employment_status FROM candidates WHERE id=$1', [legacy])).rows[0]
      .employment_status === 'employee',
    'legacy direct hire works without structural position',
  );
  check(
    (await listOrgPositions(foreignCompany)).total === 0,
    'foreign company cannot see positions',
  );
  const report = await listOrgPositions(companyId);
  check(
    report.summary.approved === 2 &&
      report.summary.available === 2 &&
      report.summary.occupied === 0,
    'headcount totals consistent after exit/release',
  );
  console.log(`Organizational headcount: ${checks} checks passed`);
} finally {
  for (const companyId of companies) {
    await query('DELETE FROM org_position_recruitments WHERE company_id=$1', [companyId]);
    await query('DELETE FROM org_position_assignments WHERE company_id=$1', [companyId]);
    await query('DELETE FROM org_positions WHERE company_id=$1', [companyId]);
    await query('DELETE FROM candidates WHERE company_id=$1', [companyId]);
    await query('DELETE FROM users WHERE company_id=$1', [companyId]);
    await query('DELETE FROM org_units WHERE company_id=$1', [companyId]);
    await query('DELETE FROM companies WHERE id=$1', [companyId]);
  }
  await pool.end();
}
