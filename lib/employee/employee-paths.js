/**
 * Canonical English paths for the collaborator session UI.
 * Product route segments stay English (file/export names + URL paths).
 */

export const EMPLOYEE_PATH = Object.freeze({
  HOME: '/employee',
  LOGIN: '/employee/login',
  ENTER: '/employee/enter',
  SET_PASSWORD: '/employee/set-password',
  PROFILE: '/employee/profile',
});

/** Auth pages that must not require an employee cookie. */
export const EMPLOYEE_PUBLIC_PATHS = Object.freeze([
  EMPLOYEE_PATH.LOGIN,
  EMPLOYEE_PATH.ENTER,
  EMPLOYEE_PATH.SET_PASSWORD,
]);

export function isEmployeeAppPath(pathname) {
  const p = String(pathname || '');
  return p === EMPLOYEE_PATH.HOME || p.startsWith(`${EMPLOYEE_PATH.HOME}/`);
}

export function isPublicEmployeeAuthPath(pathname) {
  const p = String(pathname || '');
  return EMPLOYEE_PUBLIC_PATHS.some((base) => p === base || p.startsWith(`${base}/`));
}
