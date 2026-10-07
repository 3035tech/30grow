import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { EmployeeFieldClient } from './EmployeeFieldClient';
import { EmployeePageLoading } from '../../_components/EmployeeDedicatedShell';
import { EMPLOYEE_COOKIE_NAME } from '../../../lib/employee-auth-constants.js';
import { isEmployeeSessionPayload, verifyEmployeeToken } from '../../../lib/employee-auth.js';
import { normalizeLocale } from '../../../lib/i18n.js';
import { query } from '../../../lib/db.js';
import { getFieldAccess } from '../../../lib/people/field-team.js';
import { I18nBoot } from '../../_components/I18nBoot';

export const dynamic = 'force-dynamic';

export default async function EmployeeFieldPage(props) {
  const searchParams = await props.searchParams;
  const jar = await cookies();
  const token = jar.get(EMPLOYEE_COOKIE_NAME)?.value;
  const payload = token ? verifyEmployeeToken(token) : null;
  if (!isEmployeeSessionPayload(payload)) {
    redirect('/employee/login?reason=expired');
  }
  const access = await getFieldAccess(query, {
    companyId: payload.companyId,
    candidateId: payload.candidateId,
  });
  if (!access.ok || !access.enabled) redirect('/employee');
  const locale = normalizeLocale(searchParams?.locale || payload.locale);
  return (
    <Suspense fallback={<EmployeePageLoading locale={locale} titleKey="panel.field.employeePageTitle" hintKey="panel.field.employeePageHint" />}>
      <I18nBoot locales={[locale]}><EmployeeFieldClient locale={locale} /></I18nBoot>
    </Suspense>
  );
}
