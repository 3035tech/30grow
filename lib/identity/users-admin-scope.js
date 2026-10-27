import { isAdminRole } from './permissions.js';

/**
 * Non-admin managers (e.g. company creator) only touch hr/direction of their own tenant.
 * @param {{ companyId: number|null, role?: string }} user
 * @param {{ isAdmin: boolean, companyId: number|null }} scope
 */
export function assertUserInScope(user, scope) {
  if (!scope?.isAdmin && scope?.companyId == null) return false;
  if (scope.isAdmin) return true;
  if (isAdminRole(user?.role)) return false;
  return user?.companyId != null && Number(user.companyId) === Number(scope.companyId);
}
