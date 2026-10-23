import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, COOKIE_NAME } from '../../lib/auth';
import { queryRead } from '../../lib/db';
import { normalizeLocale } from '../../lib/i18n';
import { isManagerRole, isSuperAdminPayload } from '../../lib/permissions';
import { attachCapabilityOverrides } from '../../lib/user-capabilities';

/**
 * Light auth for dashboard chrome (JWT + optional display name).
 * Heavy tab queries stay in loadDashboardTabData / Suspense.
 */
export async function resolveDashboardAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const rawPayload = token ? verifyToken(token) : null;
  const rawUserId = rawPayload?.userId ?? null;
  const [payload, profileRes] = await Promise.all([
    attachCapabilityOverrides(rawPayload),
    rawUserId
      ? queryRead(
        `SELECT (SELECT name FROM companies WHERE id=users.company_id) AS "companyName",
                email, display_name AS "displayName",
                onboarding_completed AS "onboardingCompleted",
                signup_metadata->>'fullName' AS "signupFullName"
         FROM users WHERE id = $1 AND deleted = FALSE LIMIT 1`,
        [rawUserId]
      ).catch(() => null)
      : null,
  ]);
  if (!isManagerRole(payload)) redirect('/login');
  const isAdmin = isSuperAdminPayload(payload);
  const companyId = payload?.companyId ?? null;
  const locale = normalizeLocale(payload?.locale);
  if (!isAdmin && !companyId) redirect('/login');

  let authUser = {
    userId: payload?.userId ?? null,
    role: payload?.role || null,
    companyId: payload?.companyId ?? null,
    // Keep tenant module entitlements in the client auth snapshot as well as
    // the server payload. Navigation and deep-link parsing must use the same
    // source of truth as admin API authorization.
    companyModules: Array.isArray(payload?.companyModules) ? payload.companyModules : null,
    companyOwner: payload?.companyOwner === true,
    accessRestricted: payload?.billingRestricted === true,
    locale,
    email: null,
    displayName: null,
    signupFirstName: null,
    onboardingCompleted: true, // default true (coluna pode não existir ainda)
    /** Wizard “Primeiros passos” — todo gestor novo, exceto super admin. */
    showOnboardingWizard: false,
    capabilitiesCustomized: Boolean(payload?.capabilitiesCustomized),
    capabilityOverrides: Array.isArray(payload?.capabilityOverrides)
      ? payload.capabilityOverrides
      : [],
  };
  // profileRes is null when display_name / onboarding columns are missing before migrations.
  if (payload?.userId && profileRes?.rowCount) {
    const row = profileRes.rows[0];
    const onboardingCompleted = row.onboardingCompleted !== false;
    // Todo gestor novo configura a empresa; super admin mantém acesso integral.
    const showOnboardingWizard =
      !isSuperAdminPayload(payload) && !onboardingCompleted;
    authUser = {
      ...authUser,
      email: row.email,
      companyName: row.companyName || null,
      displayName: row.displayName,
      signupFirstName: String(row.signupFullName || '').trim().split(/\s+/)[0] || null,
      onboardingCompleted,
      showOnboardingWizard,
    };
  }

  return { authUser, locale, payload, isAdmin, companyId };
}
