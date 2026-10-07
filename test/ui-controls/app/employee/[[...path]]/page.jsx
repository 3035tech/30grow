'use client';
// Real product screens under their canonical paths, only in the isolated fixture app.
import { usePathname } from 'next/navigation';
import { EmployeeHomeClient } from '../../../../../app/employee/EmployeeHomeClient';
import { EmployeeProfileClient } from '../../../../../app/employee/profile/EmployeeProfileClient';
import { EmployeePdiClient } from '../../../../../app/employee/pdi/EmployeePdiClient';
import { EmployeeDpClient } from '../../../../../app/employee/dp/EmployeeDpClient';
import { EmployeeLmsClient } from '../../../../../app/employee/lms/EmployeeLmsClient';
import { EmployeeTimeClockClient } from '../../../../../app/employee/time-clock/EmployeeTimeClockClient';
import { EmployeeLoginClient } from '../../../../../app/employee/login/EmployeeLoginClient';
export default function EmployeeFixture() {
  const path = usePathname();
  const View = {
    '/employee': EmployeeHomeClient,
    '/employee/profile': EmployeeProfileClient,
    '/employee/pdi': EmployeePdiClient,
    '/employee/dp': EmployeeDpClient,
    '/employee/lms': EmployeeLmsClient,
    '/employee/time-clock': EmployeeTimeClockClient,
    '/employee/login': EmployeeLoginClient,
  }[path] || EmployeeHomeClient;
  return <View />;
}
