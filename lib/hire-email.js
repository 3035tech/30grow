import { ERR } from './api-error-codes.js';
import { EMPLOYMENT_STATUS } from './domain-status.js';
import { isValidEmployeeEmail, revokeEmployeeAccessForEmailChange, finishEmployeeEmailChange, issueEmployeePasswordInvite } from './employee-auth.js';

// Called with the candidate row locked, in the same transaction as the hire.
export async function prepareHireEmail(db, person, { candidateId, companyId, corporateEmail, personalEmail, inviteAccess = false, autoInvite = true }) {
  if (!person) throw Object.assign(new Error(ERR.CANDIDATE_NOT_FOUND), { code: ERR.CANDIDATE_NOT_FOUND });
  const email = corporateEmail == null ? '' : String(corporateEmail).trim().toLowerCase();
  if (email && (email.length > 254 || !isValidEmployeeEmail(email))) throw Object.assign(new Error(ERR.INVALID_EMAIL), { code: ERR.INVALID_EMAIL });
  const personal = personalEmail == null ? '' : String(personalEmail).trim().toLowerCase();
  if (personal && (personal.length > 254 || !isValidEmployeeEmail(personal))) throw Object.assign(new Error(ERR.INVALID_EMAIL), { code: ERR.INVALID_EMAIL });
  const previousEmail = String(person.email || '').trim().toLowerCase();
  const firstHire = person.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE;
  if (email && email !== previousEmail && !firstHire) {
    // Changing an existing employee's identity uses the permission-checked profile flow.
    throw Object.assign(new Error(ERR.EMPLOYEE_EMAIL_CHANGE_FORBIDDEN), { code: ERR.EMPLOYEE_EMAIL_CHANGE_FORBIDDEN });
  }
  if (inviteAccess || personal) await db.query(`UPDATE candidates SET
    personal_email = COALESCE(NULLIF($4, ''), NULLIF(BTRIM(personal_email), ''), CASE WHEN $5::boolean AND employment_status = 'candidate' THEN email ELSE NULL END),
    email = COALESCE(NULLIF($3, ''), email)
    WHERE id=$1 AND company_id=$2`, [candidateId, companyId, email, personal, inviteAccess]);
  const revoked = email && email !== previousEmail && inviteAccess
    ? await revokeEmployeeAccessForEmailChange(db, { candidateId, companyId }) : null;
  return { currentEmail: email || previousEmail, shouldInvite: inviteAccess && firstHire && autoInvite, previousEmail, revoked };
}

export async function finishHireEmail({ candidateId, companyId, emailAccess, locale = 'pt-BR' }, dbQuery) {
  if (!emailAccess) return null;
  if (emailAccess.revoked) {
    const result = await finishEmployeeEmailChange(dbQuery, { candidateId, companyId, ...emailAccess, locale });
    if (result) return result;
  }
  if (!emailAccess.shouldInvite) return null;
  try {
    const result = await issueEmployeePasswordInvite(dbQuery, { candidateId, companyId, locale, purpose: 'invite' });
    return { inviteSent: Boolean(result?.ok && result.sent) };
  } catch {
    return { inviteSent: false };
  }
}
