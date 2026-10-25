/** No password hashes or invitation tokens leave the protected read model. */
export const EMPLOYEE_ACCESS_STATE_SQL = `CASE
  WHEN c.employment_status<>'employee' THEN NULL
  WHEN c.password_hash IS NOT NULL THEN 'active'
  WHEN c.password_setup_token IS NOT NULL AND c.password_setup_expires_at>now() THEN 'invited'
  WHEN c.access_invited_at IS NOT NULL THEN 'expired'
  ELSE 'not_invited' END`;

export async function loadEmployeeAdmissionState(query, { companyId, candidateId }) {
  const result = await query(`SELECT c.id AS "candidateId",c.email,c.personal_email AS "personalEmail",
    c.employment_status AS "employmentStatus",c.start_date::text AS "startDate",
    ${EMPLOYEE_ACCESS_STATE_SQL} AS "employeeAccessState"
    FROM candidates c WHERE c.id=$1 AND c.company_id=$2`, [candidateId,companyId]);
  return result.rows[0] || null;
}
