import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { EmployeeDpClient } from './EmployeeDpClient';
import { EmployeePageLoading } from '../../_components/EmployeeDedicatedShell';
import { EMPLOYEE_COOKIE_NAME } from '../../../lib/employee/employee-auth-constants.js';
import { isEmployeeSessionPayload, verifyEmployeeToken } from '../../../lib/employee/employee-auth.js';
import { normalizeLocale } from '../../../lib/i18n.js';
import { I18nBoot } from '../../_components/I18nBoot';

export const dynamic = 'force-dynamic';

export default async function EmployeeDpPage(props) {
  const searchParams = await props.searchParams;
  const jar = await cookies();
  const token = jar.get(EMPLOYEE_COOKIE_NAME)?.value;
  const payload = token ? verifyEmployeeToken(token) : null;
  if (!isEmployeeSessionPayload(payload)) {
    redirect('/employee/login?reason=expired');
  }
  const locale = normalizeLocale(searchParams?.locale || payload.locale);
  return (
    <Suspense fallback={<EmployeePageLoading locale={locale} titleKey="employeeHome.dpPageTitle" hintKey="employeeHome.dpPageHint" />}>
      <I18nBoot locales={[locale]}><EmployeeDpClient locale={locale} /></I18nBoot>
    </Suspense>
  );
}
