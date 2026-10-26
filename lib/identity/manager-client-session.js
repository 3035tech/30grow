/**
 * Client helpers for manager session UX (login / expiry redirects).
 */

import { sanitizeLoginRedirect } from './sanitize-login-redirect.js';

export function managerLoginUrl({ reason, redirect } = {}) {
  const q = new URLSearchParams();
  if (reason) q.set('reason', String(reason).slice(0, 40));
  if (redirect != null && redirect !== '') {
    q.set('redirect', sanitizeLoginRedirect(redirect));
  }
  const qs = q.toString();
  return qs ? `/login?${qs}` : '/login';
}

/** @returns {boolean} true if redirected (caller should stop) */
export function redirectManagerIfUnauthorized(status, { reason = 'expired', redirect } = {}) {
  if (status !== 401) return false;
  const next =
    redirect != null
      ? redirect
      : typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search || ''}`
        : '/dashboard';
  const url = managerLoginUrl({ reason, redirect: next });
  if (typeof window !== 'undefined') {
    window.location.assign(url);
  }
  return true;
}
