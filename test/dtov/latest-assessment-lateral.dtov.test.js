/**
 * DTOV: B-2804.9 — "latest assessment per person" reads driven by candidates + LATERAL
 * return exactly what the previous DISTINCT ON queries returned (company nucleus and
 * behavioral intel cohort), including caps, filters and alumni rules.
 */
import assert from 'node:assert/strict';
import { query } from '../../lib/db.js';
import { loadCompanyInternalNucleus } from '../../lib/people/company-nucleus.js';
import { loadPeopleByFilters } from '../../lib/people/load-team-behavioral-intel.js';
import { EMPLOYMENT_STATUS, ROSTER_SCOPE } from '../../lib/domain-status.js';
import { rosterScopeSqlPart } from '../../lib/roster-scope-sql.js';
import { TEAM_INTEL_PEOPLE_CAP } from '../../lib/people/team-behavioral-intel.js';

const db = { query, queryRead: query };

async function oldNucleus(companyId, cap) {
  const res = await query(
    `SELECT DISTINCT ON (c.id) c.id AS id, c.full_name AS name, ass.top_type AS "topType"
     FROM assessments ass
     JOIN candidates c ON c.id = ass.candidate_id
     WHERE ass.company_id = $1
       AND ass.top_type BETWEEN 1 AND 9
       AND c.employment_status <> '${EMPLOYMENT_STATUS.ALUMNI}'
       AND (ass.vacancy_id IS NULL OR c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}')
     ORDER BY c.id, ass.created_at DESC NULLS LAST, ass.id DESC
     LIMIT $2`,
    [companyId, cap]
  );
  return res.rows.map((r) => ({ id: r.id, name: r.name || '', topType: Number(r.topType) }));
}

async function oldCohort(ctx) {
  const parts = [];
  const params = [];
  const companyFilter = ctx.isAdmin ? ctx.scopeCompanyFilter : ctx.companyId;
  if (companyFilter != null) {
    params.push(companyFilter);
    parts.push(`ass.company_id = $${params.length}`);
  }
  if (ctx.selectedArea && ctx.selectedArea !== 'all') {
    params.push(ctx.selectedArea);
    parts.push(`ar.key = $${params.length}`);
  }
  const vacancyPinned = ctx.selectedVacancy != null && ctx.selectedVacancy !== 'all';
  if (vacancyPinned) {
    params.push(Number(ctx.selectedVacancy));
    parts.push(`ass.vacancy_id = $${params.length}`);
  }
  const roster = vacancyPinned ? null : rosterScopeSqlPart(ctx.rosterScope ?? ROSTER_SCOPE.INTERNAL);
  if (roster) parts.push(roster);
  if (ctx.dateFrom) {
    params.push(ctx.dateFrom);
    parts.push(`ass.created_at >= $${params.length}::date`);
  }
  if (ctx.dateTo) {
    params.push(ctx.dateTo);
    parts.push(`ass.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (ctx.nameSearch) {
    params.push(`%${ctx.nameSearch}%`);
    parts.push(`c.full_name ILIKE $${params.length}`);
  }
  params.push(TEAM_INTEL_PEOPLE_CAP);
  const res = await query(
    `SELECT DISTINCT ON (ass.candidate_id)
       ass.candidate_id AS "candidateId", ass.top_type AS "topType", ass.scores
     FROM assessments ass
     JOIN candidates c ON c.id = ass.candidate_id
     LEFT JOIN areas ar ON ar.id = ass.area_id
     LEFT JOIN vacancies v ON v.id = ass.vacancy_id AND v.deleted = FALSE
     ${parts.length ? `WHERE ${parts.join(' AND ')}` : ''}
     ORDER BY ass.candidate_id, ass.created_at DESC, ass.id DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({
    candidateId: Number(r.candidateId),
    topType: r.topType != null ? Number(r.topType) : null,
    scores: r.scores && typeof r.scores === 'object' ? r.scores : null,
  }));
}

async function main() {
  const co = await query(`SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`);
  assert.ok(co.rowCount, 'demo company missing — run dtov:reset');
  const companyId = Number(co.rows[0].id);

  const people = await query(
    `SELECT c.id, c.employment_status AS status, c.full_name AS name,
            a.area_id AS "areaId", a.vacancy_id AS "vacancyId", ar.key AS "areaKey"
     FROM candidates c
     JOIN LATERAL (SELECT area_id, vacancy_id FROM assessments WHERE candidate_id = c.id ORDER BY id LIMIT 1) a ON TRUE
     LEFT JOIN areas ar ON ar.id = a.area_id
     WHERE c.company_id = $1
     ORDER BY c.id`,
    [companyId]
  );
  const byStatus = (s) => people.rows.filter((p) => p.status === s);
  const employee = byStatus(EMPLOYMENT_STATUS.EMPLOYEE)[0];
  const alumni = byStatus(EMPLOYMENT_STATUS.ALUMNI)[0];
  const applicant = people.rows.find((p) => p.status === EMPLOYMENT_STATUS.CANDIDATE && p.vacancyId);
  assert.ok(employee && alumni && applicant, 'seed needs employee, alumni and vacancy applicant');

  // Several assessments per person: newer and older ones, a newer vacancy assessment
  // for an employee, and a newest non-vacancy one for an applicant (enters the nucleus).
  const extra = await query(
    `INSERT INTO assessments (candidate_id, company_id, area_id, vacancy_id, top_type, scores, created_at)
     VALUES
       ($1, $4, $5, NULL, 7, '{"7":30}', NOW() + INTERVAL '1 hour'),
       ($1, $4, $5, NULL, 2, '{"2":30}', NOW() - INTERVAL '400 days'),
       ($1, $4, $5, $6, 4, '{"4":30}', NOW() + INTERVAL '2 hours'),
       ($2, $4, $5, NULL, 9, '{"9":30}', NOW() + INTERVAL '1 hour'),
       ($3, $4, $5, $6, 3, '{"3":30}', NOW() + INTERVAL '1 hour'),
       ($3, $4, $5, NULL, 5, '{"5":30}', NOW() + INTERVAL '3 hours')
     RETURNING id`,
    [employee.id, alumni.id, applicant.id, companyId, employee.areaId, applicant.vacancyId]
  );
  const extraIds = extra.rows.map((r) => Number(r.id));

  try {
    for (const cap of [1, 3, 24, 40]) {
      assert.deepEqual(
        await loadCompanyInternalNucleus(db, { companyId, limit: cap }),
        await oldNucleus(companyId, cap),
        `nucleus cap ${cap}`
      );
    }
    const nucleus = await loadCompanyInternalNucleus(db, { companyId, limit: 40 });
    assert.equal(nucleus.find((n) => n.id === employee.id)?.topType, 4, 'employee: newest incl. vacancy');
    assert.ok(!nucleus.some((n) => n.id === alumni.id), 'alumni out of nucleus');
    assert.equal(nucleus.find((n) => n.id === applicant.id)?.topType, 5, 'applicant: newest non-vacancy');

    const today = new Date().toISOString().slice(0, 10);
    const cases = [
      { isAdmin: false, companyId },
      { isAdmin: false, companyId, rosterScope: ROSTER_SCOPE.RECRUITING },
      { isAdmin: false, companyId, rosterScope: ROSTER_SCOPE.ALUMNI },
      { isAdmin: false, companyId, rosterScope: ROSTER_SCOPE.ALL },
      { isAdmin: false, companyId, selectedVacancy: String(applicant.vacancyId) },
      { isAdmin: false, companyId, selectedArea: employee.areaKey, rosterScope: ROSTER_SCOPE.ALL },
      { isAdmin: false, companyId, dateFrom: '2000-01-01', dateTo: today, rosterScope: ROSTER_SCOPE.ALL },
      { isAdmin: false, companyId, nameSearch: employee.name.slice(0, 3) },
      { isAdmin: true, scopeCompanyFilter: companyId },
      { isAdmin: true, scopeCompanyFilter: null, rosterScope: ROSTER_SCOPE.ALL },
    ];
    let nonEmpty = 0;
    for (const ctx of cases) {
      const got = await loadPeopleByFilters(db, ctx);
      assert.deepEqual(got, await oldCohort(ctx), `cohort ${JSON.stringify(ctx)}`);
      if (got.length) nonEmpty += 1;
    }
    assert.ok(nonEmpty >= 6, 'filter cases exercise real rows');

    console.log('[dtov] latest-assessment-lateral ok', {
      nucleus: nucleus.length,
      cohortCases: cases.length,
    });
  } finally {
    await query(`DELETE FROM assessments WHERE id = ANY($1::bigint[])`, [extraIds]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
