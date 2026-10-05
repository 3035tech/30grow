'use client';

import { useCallback, useEffect, useState } from 'react';
import { t } from '../../../lib/i18n';
import { EmployeeDedicatedShell } from '../../_components/EmployeeDedicatedShell';
import { EmployeeTimeClockSection } from '../../_components/EmployeeTimeClockSection';
import { EmployeeTimeClockHistory } from '../../_components/EmployeeTimeClockHistory';
import { EmployeeHourBankSection } from '../../_components/EmployeeHourBankSection';
import { useEmployeeNav } from '../../_components/EmployeeNavContext';

/**
 * Dedicated collaborator time clock: punch in/out, history with adjustment/excuse
 * requests, and hour bank.
 */
export function EmployeeTimeClockClient({ locale = 'pt-BR' }) {
  const { setNavMeta } = useEmployeeNav();
  const [historyKey, setHistoryKey] = useState(0);

  const onBadge = useCallback(
    (n) => setNavMeta({ badges: { timeClock: Number(n) || 0 } }),
    [setNavMeta]
  );
  const onPunched = useCallback(() => setHistoryKey((k) => k + 1), []);

  useEffect(() => {
    const prev = document.title;
    document.title = t(locale, 'employeeHome.timeClockDocumentTitle');
    return () => {
      document.title = prev;
    };
  }, [locale]);

  return (
    <EmployeeDedicatedShell
      locale={locale}
      title={t(locale, 'employeeHome.timeClockPageTitle')}
      hint={t(locale, 'employeeHome.timeClockPageHint')}
    >
      <section className="rounded-card border border-ink/12 bg-surface p-4 sm:p-5"><EmployeeTimeClockSection locale={locale} onBadge={onBadge} onPunched={onPunched} /></section>
      <section className="mt-4 rounded-card border border-ink/12 bg-surface p-4 sm:p-5" aria-labelledby="emp-tc-history-title">
        <h2 id="emp-tc-history-title" className="mb-1 mt-0 font-ui text-base font-semibold text-ink">
          {t(locale, 'panel.timeRequests.historyTitle')}
        </h2>
        <p className="mb-3 mt-0 font-ui text-prose text-ink-muted">{t(locale, 'panel.timeRequests.historyHint')}</p>
        <EmployeeTimeClockHistory locale={locale} reloadKey={historyKey} />
      </section>
      <div className="mt-4 rounded-card border border-ink/12 bg-surface p-4 sm:p-5">
        <h2 className="mb-3 mt-0 font-ui text-base font-semibold text-ink">
          {t(locale, 'employeeHome.hourBank.sectionTitle')}
        </h2>
        <EmployeeHourBankSection locale={locale} />
      </div>
    </EmployeeDedicatedShell>
  );
}
