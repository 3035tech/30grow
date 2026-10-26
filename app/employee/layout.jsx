import { cookies } from 'next/headers';
import { EmployeeShell } from '../_components/EmployeeShell';
import { I18nBoot } from '../_components/I18nBoot';
import {
  EMPLOYEE_COOKIE_NAME,
} from '../../lib/employee/employee-auth-constants.js';
import { verifyEmployeeToken, isEmployeeSessionPayload } from '../../lib/employee/employee-auth.js';
import { getEmployeeProfile } from '../../lib/employee/employee-profile.js';
import { query } from '../../lib/db.js';
import { normalizeLocale } from '../../lib/i18n.js';

export const dynamic = 'force-dynamic';

/** Name/company for the chrome on first paint, so sidebar and top bar do not swap text after load. */
async function loadChromePerson(payload) {
  try {
    const result = await getEmployeeProfile(query, {
      companyId: payload.companyId,
      candidateId: payload.candidateId,
    });
    return result.ok ? result.person : null;
  } catch {
    return null;
  }
}

export default async function EmployeeLayout({ children }) {
  const jar = await cookies();
  const token = jar.get(EMPLOYEE_COOKIE_NAME)?.value;
  const payload = token ? verifyEmployeeToken(token) : null;
  const signedIn = isEmployeeSessionPayload(payload);
  const person = signedIn ? await loadChromePerson(payload) : null;
  const locale = signedIn ? normalizeLocale(person?.preferredLocale || payload.locale) : 'pt-BR';

  return (
    <I18nBoot locales={[locale]}>
      <EmployeeShell
        initialLocale={locale}
        personName={person?.fullName || ''}
        companyName={person?.companyName || ''}
        companyLogoUrl={person?.companyLogoUrl || ''}
      >
        {children}
      </EmployeeShell>
    </I18nBoot>
  );
}
