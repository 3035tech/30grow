/** One bounded read for the visible page. Every relation retains its tenant key. */
export async function loadOperationalSummaries(query, people) {
  const refs = [...new Map((people || []).filter(row => row.candidateId && row.companyId)
    .map(row => [`${row.companyId}:${row.candidateId}`, row])).values()].slice(0, 100);
  if (!refs.length) return {};
  const result = await query(`SELECT c.id, c.company_id AS "companyId",
      c.employment_status AS "employmentStatus", c.start_date AS "startDate", c.hired_at AS "hiredAt",
      co.name AS "companyName", jr.name AS "jobRoleName", u.name AS "orgUnitName", m.full_name AS "managerName",
      (SELECT COUNT(*)::int FROM development_plan_items i
       JOIN development_plans p ON p.id=i.plan_id AND p.company_id=i.company_id
       WHERE p.candidate_id=c.id AND p.company_id=c.company_id AND p.status='active'
         AND i.status<>'done' AND i.due_date<CURRENT_DATE) AS "pdiOverdue",
      (SELECT COUNT(*)::int FROM employee_onboarding_checkins o
       WHERE o.candidate_id=c.id AND o.company_id=c.company_id AND o.status='pending'
         AND o.due_date<CURRENT_DATE) AS "onboardingOverdue",
      (SELECT COUNT(*)::int FROM lms_enrollments e
       JOIN lms_courses course ON course.id=e.course_id AND course.company_id=e.company_id
       WHERE e.candidate_id=c.id AND e.company_id=c.company_id AND e.completed_at IS NULL
         AND e.due_date<CURRENT_DATE AND course.active=TRUE) AS "lmsOverdue"
    FROM candidates c
    JOIN companies co ON co.id=c.company_id
    LEFT JOIN job_roles jr ON jr.id=c.job_role_id AND jr.company_id=c.company_id
    LEFT JOIN org_units u ON u.id=c.org_unit_id AND u.company_id=c.company_id
    LEFT JOIN candidates m ON m.id=c.manager_candidate_id AND m.company_id=c.company_id
    WHERE (c.id,c.company_id) IN (SELECT * FROM unnest($1::bigint[],$2::bigint[]))`,
    [refs.map(row => row.candidateId), refs.map(row => row.companyId)]);
  return Object.fromEntries(result.rows.map(row => [String(row.id), {
    ...row, overdueCount: Number(row.pdiOverdue) + Number(row.onboardingOverdue) + Number(row.lmsOverdue),
  }]));
}
