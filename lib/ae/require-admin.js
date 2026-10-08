import { runtimeAppUrl } from '../app-url.js';
import { cookies } from 'next/headers';
import { verifyToken, COOKIE_NAME } from '../auth.js';
import {
  CAP,
  canAccessAnalysisData,
  canAccessCandidateRecord,
  isAdminRole,
  isManagerRole,
  requireAnyCapability,
  requireCapability,
} from '../permissions.js';
import { attachCapabilityOverrides } from '../user-capabilities.js';

export {
  CAP,
  canAccessAnalysisData,
  canAccessCandidateRecord,
  isAdminRole,
  isManagerRole,
  requireAnyCapability,
  requireCapability,
};

export { verifySessionWithCapabilities } from '../user-capabilities.js';

export function requireManagerRole(payload) {
  return isManagerRole(payload);
}

export function requireAdminRole(payload) {
  return isAdminRole(payload);
}

/** Cookie session + per-user capability overrides (etapa 3). */
export async function getSessionPayload() {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  const payload = session ? verifyToken(session) : null;
  return attachCapabilityOverrides(payload);
}

export function getManagerScope(payload) {
  const isAdmin = isAdminRole(payload);
  const companyId = payload?.companyId ?? null;
  return { isAdmin, companyId, authorized: isAdmin || companyId != null };
}

/**
 * Resolve tenant company id for manager APIs.
 * Admin may pass query/body companyId; hr/direction always use session company.
 * @returns {number|null}
 */
export function resolveScopedCompanyId(scope, rawCompanyId) {
  if (!scope?.authorized) return null;
  if (scope.isAdmin) {
    const cid = rawCompanyId != null && rawCompanyId !== '' ? Number(rawCompanyId) : Number(scope.companyId);
    return Number.isFinite(cid) && cid > 0 ? cid : null;
  }
  const cid = Number(scope.companyId);
  return Number.isFinite(cid) && cid > 0 ? cid : null;
}

/**
 * Base URL para links em e-mail. Em produção usa APP_URL (runtime), com fallback legado NEXT_PUBLIC_APP_URL (anti Host injection).
 * Em desenvolvimento, Host/x-forwarded-* como fallback.
 */
export function publicAppUrl(request) {
  const env = (runtimeAppUrl() || '').trim();
  if (env) return env.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return '';
  const host = request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host');
  const proto = (request?.headers?.get?.('x-forwarded-proto') || 'http').split(',')[0]?.trim() || 'http';
  if (host) return `${proto}://${host}`.replace(/\/$/, '');
  return '';
}
