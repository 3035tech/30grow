/**
 * Client helpers for collaborator session UX (login / expiry redirects).
 */

import { EMPLOYEE_PATH } from './employee-paths.js';

export function employeeLoginUrl({ reason } = {}) {
  const base = EMPLOYEE_PATH.LOGIN || '/employee/login';
  if (!reason) return base;
  const q = new URLSearchParams({ reason: String(reason) });
  return `${base}?${q.toString()}`;
}

/** @returns {boolean} true if redirected (caller should stop) */
export function redirectEmployeeIfUnauthorized(router, status, { reason = 'expired' } = {}) {
  if (status !== 401) return false;
  if (typeof router?.replace === 'function') {
    router.replace(employeeLoginUrl({ reason }));
  } else if (typeof window !== 'undefined') {
    window.location.assign(employeeLoginUrl({ reason }));
  }
  return true;
}
