/**
 * Resolve employee session from request cookies (Node API routes).
 */

import { cookies } from 'next/headers';
import { EMPLOYEE_COOKIE_NAME } from './employee-auth-constants.js';
import { verifyEmployeeToken, isEmployeeSessionPayload } from './employee-auth.js';
import { getCompanyEnabledModules } from '../company/company-module-entitlements.js';
import { loadEmployeeSessionVersion } from './employee-session-revocation.js';
import { EMPLOYMENT_STATUS } from '../domain-status.js';

export async function getEmployeeSessionPayload() {
  const jar = await cookies();
  const token = jar.get(EMPLOYEE_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyEmployeeToken(token);
  if (!isEmployeeSessionPayload(payload)) return null;
  const sv = Number(payload.sv);
  if (!Number.isSafeInteger(sv) || sv < 1) return null;
  // Authorize at the data boundary too: the proxy can lose its self-fetch.
  const live = await loadEmployeeSessionVersion(payload.candidateId, payload.companyId);
  if (!live || live.sessionVersion !== sv || live.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return null;
  }
  let companyModules = null;
  if (payload.companyId) {
    companyModules = await getCompanyEnabledModules(null, payload.companyId);
  }
  return { ...payload, companyModules };
}
