'use client';

import { t } from '../../lib/i18n';
import { S } from '../dashboard/dashboard-shared';

export function EmployeeTimeClockMirrorPrintButton({ locale }) {
  return (
    <button type="button" className={S.btnPrimary} onClick={() => window.print()}>
      {t(locale, 'employeeHome.timeClock.reportPrint')}
    </button>
  );
}
