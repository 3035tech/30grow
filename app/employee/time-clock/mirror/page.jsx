import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { EMPLOYEE_COOKIE_NAME } from '../../../../lib/employee/employee-auth-constants.js';
import { isEmployeeSessionPayload, verifyEmployeeToken } from '../../../../lib/employee/employee-auth.js';
import { normalizeLocale, localeHtmlLang, t } from '../../../../lib/i18n.js';
import { query } from '../../../../lib/db.js';
import { getEmployeeTimeMirror } from '../../../../lib/people/time-clock-manager.js';
import { getTimeClockAccess } from '../../../../lib/people/time-clock.js';
import { isValidTimeClockFormalMonth, missingTimeClockFormalMirrorFields } from '../../../../lib/people/time-clock-formal-mirror.js';
import { formatCpfBr, formatCpfCnpjBr } from '../../../../lib/br-masks.js';
import { formatMinutesClock } from '../../../../lib/time-clock-format.js';
import { EmployeeDedicatedShell } from '../../../_components/EmployeeDedicatedShell';
import { EmployeeTimeClockMirrorPrintButton } from '../../../_components/EmployeeTimeClockMirrorPrintButton';
import { REP_P_INPI_REGISTRATION } from '../../../../lib/rep/provider.js';

export const dynamic = 'force-dynamic';

function dateLabel(iso, locale) {
  return new Intl.DateTimeFormat(localeHtmlLang(locale), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
}

function rangeLabel(from, to, locale) {
  return `${dateLabel(from, locale)} – ${dateLabel(to, locale)}`;
}

function issuedLabel(locale, timezone) {
  return new Intl.DateTimeFormat(localeHtmlLang(locale), {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timezone || 'America/Sao_Paulo',
  }).format(new Date());
}

function contractLabel(schedule, locale) {
  if (!schedule) return t(locale, 'employeeHome.timeClock.reportNotInformed');
  const parts = [`${schedule.workdayStart}–${schedule.workdayEnd}`];
  if (schedule.breakStart && schedule.breakEnd) {
    parts.push(t(locale, 'employeeHome.timeClock.reportBreakRange', {
      start: schedule.breakStart,
      end: schedule.breakEnd,
    }));
  } else if (schedule.breakMinutes) {
    parts.push(t(locale, 'employeeHome.timeClock.reportBreakMinutes', {
      minutes: schedule.breakMinutes,
    }));
  }
  if (schedule.breakPreassigned) parts.push(t(locale, 'employeeHome.timeClock.reportBreakPreassigned'));
  return parts.join(' · ');
}

export default async function EmployeeTimeClockMirrorPage({ searchParams }) {
  const params = await searchParams;
  const from = String(params?.from || '');
  const to = String(params?.to || '');
  if (!isValidTimeClockFormalMonth(from, to)) notFound();

  const jar = await cookies();
  const token = jar.get(EMPLOYEE_COOKIE_NAME)?.value;
  const payload = token ? verifyEmployeeToken(token) : null;
  if (!isEmployeeSessionPayload(payload)) redirect('/employee/login?reason=expired');

  const access = await getTimeClockAccess(query, {
    companyId: payload.companyId,
    candidateId: payload.candidateId,
  });
  if (!access.ok || !access.enabled) redirect('/employee');

  const locale = normalizeLocale(params?.locale || payload.locale);
  const mirror = await getEmployeeTimeMirror(query, {
    companyId: payload.companyId,
    candidateId: payload.candidateId,
    from,
    to,
  });
  if (!mirror.ok || mirror.from !== from || mirror.to !== to) notFound();

  let identity = null;
  try {
    const result = await query(
      `SELECT w.cpf, w.worker_name AS "registeredWorkerName", e.employer_name AS "employerName",
              e.employer_document AS "employerDocument",
              e.complementary_document AS "complementaryDocument",
              e.workplace, e.timezone
       FROM rep_workers w
       JOIN rep_establishments e
         ON e.id = w.establishment_id AND e.company_id = w.company_id
       WHERE w.company_id = $1 AND w.candidate_id = $2
       LIMIT 1`,
      [payload.companyId, payload.candidateId],
    );
    identity = result.rows[0] ? { ...result.rows[0], registration: REP_P_INPI_REGISTRATION } : null;
  } catch {
    identity = null;
  }

  const missing = missingTimeClockFormalMirrorFields(mirror, identity);
  const tz = mirror.schedule?.timezone || 'America/Sao_Paulo';
  const period = rangeLabel(from, to, locale);
  const scheduleRowsByLabel = new Map();
  for (const day of mirror.days) {
    const key = contractLabel(day.daySchedule, locale);
    if (!scheduleRowsByLabel.has(key)) scheduleRowsByLabel.set(key, { label: key, days: [] });
    scheduleRowsByLabel.get(key).days.push(day.day);
  }
  const scheduleRows = [...scheduleRowsByLabel.values()];
  const days = [...mirror.days].sort((a, b) => a.day.localeCompare(b.day));
  const nightMinutes = days.reduce((sum, day) => sum + (Number(day.nightMinutes) || 0), 0);
  const nightEquivalentMinutes = days.reduce((sum, day) => sum + (Number(day.nightEquivalentMinutes) || 0), 0);
  const reportTitle = t(locale, 'employeeHome.timeClock.reportTitle');

  return (
    <EmployeeDedicatedShell
      locale={locale}
      title={reportTitle}
      backHref="/employee/time-clock"
      backLabel={t(locale, 'employeeHome.timeClock.reportBack')}
      maxWidthClass="max-w-5xl"
      trailing={missing.length === 0 ? <div className="tc-report-no-print"><EmployeeTimeClockMirrorPrintButton locale={locale} /></div> : null}
    >
      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print {
          body * { visibility: hidden !important; }
          .tc-formal-mirror, .tc-formal-mirror * { visibility: visible !important; }
          .tc-formal-mirror { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
          .tc-report-no-print { display: none !important; }
          .tc-formal-mirror table { font-size: 9pt !important; }
          .tc-formal-mirror tr { break-inside: avoid; }
        }
      `}</style>
      <article className={`${missing.length === 0 ? 'tc-formal-mirror' : 'tc-report-incomplete'} rounded-card border border-ink/12 bg-surface p-4 sm:p-6`}>
        <header className="border-b border-ink/12 pb-4">
          <h2 className="mb-2 mt-0 font-ui text-xl font-semibold text-ink">{reportTitle}</h2>
          <p className="mb-1 mt-0 text-prose text-ink-muted">
            {t(locale, 'employeeHome.timeClock.reportPeriod')}: {period}
          </p>
          <p className="m-0 text-sm text-ink-muted">
            {t(locale, 'employeeHome.timeClock.reportIssued')}: {issuedLabel(locale, tz)}
          </p>
        </header>

        {missing.length ? (
          <section className="my-4 rounded-control border border-warning/40 bg-warning/5 p-4" role="status">
            <h3 className="mb-2 mt-0 text-base font-semibold text-ink">
              {t(locale, 'employeeHome.timeClock.reportUnavailableTitle')}
            </h3>
            <p className="mb-2 mt-0 text-sm text-ink-muted">
              {t(locale, 'employeeHome.timeClock.reportUnavailableBody')}
            </p>
            <ul className="mb-0 mt-0 list-disc pl-5 text-sm text-ink-muted">
              {missing.map((field) => (
                <li key={field}>{t(locale, `employeeHome.timeClock.reportField.${field}`)}</li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <section className="grid gap-4 border-b border-ink/12 py-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 mt-0 text-sm font-semibold uppercase tracking-wide text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportEmployer')}
                </h3>
                <p className="m-0 font-medium text-ink">{identity.employerName}</p>
                <p className="mb-1 mt-1 text-sm text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportEmployerDocument')}: {formatCpfCnpjBr(identity.employerDocument)}
                </p>
                {identity.complementaryDocument ? (
                  <p className="mb-1 mt-0 text-sm text-ink-muted">
                    {t(locale, 'employeeHome.timeClock.reportComplementaryDocument')}: {identity.complementaryDocument}
                  </p>
                ) : null}
                <p className="mb-1 mt-0 text-sm text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportRegistration')}: {identity.registration}
                </p>
                {identity.workplace ? (
                  <p className="m-0 text-sm text-ink-muted">
                    {t(locale, 'employeeHome.timeClock.reportWorkplace')}: {identity.workplace}
                  </p>
                ) : null}
              </div>
              <div>
                <h3 className="mb-2 mt-0 text-sm font-semibold uppercase tracking-wide text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportWorker')}
                </h3>
                <p className="m-0 font-medium text-ink">{identity.registeredWorkerName}</p>
                <p className="mb-1 mt-1 text-sm text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportCpf')}: {formatCpfBr(identity.cpf)}
                </p>
                <p className="mb-1 mt-0 text-sm text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportAdmission')}: {dateLabel(mirror.person.startDate, locale)}
                </p>
                <p className="m-0 text-sm text-ink-muted">
                  {t(locale, 'employeeHome.timeClock.reportJobRole')}: {mirror.person.jobRoleName}
                </p>
              </div>
            </section>

            <section className="border-b border-ink/12 py-4">
              <h3 className="mb-2 mt-0 text-sm font-semibold uppercase tracking-wide text-ink-muted">
                {t(locale, 'employeeHome.timeClock.reportContractSchedule')}
              </h3>
              <ul className="mb-0 mt-0 list-disc pl-5 text-sm text-ink">
                {scheduleRows.map((row) => (
                  <li key={row.label}>
                    {row.label} <span className="text-ink-muted">({row.days.map((day) => dateLabel(day, locale)).join(', ')})</span>
                  </li>
                ))}
              </ul>
              <p className="mb-0 mt-2 text-xs text-ink-muted">
                {t(locale, 'employeeHome.timeClock.reportBreakNote')}
              </p>
            </section>

            <section className="py-4">
              <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span><strong>{t(locale, 'employeeHome.timeClock.reportWorked')}:</strong> {formatMinutesClock(mirror.totals.workedMinutes)}</span>
                <span><strong>{t(locale, 'employeeHome.timeClock.reportNightAdjusted')}:</strong> {formatMinutesClock(mirror.totals.workedMinutes - nightMinutes + nightEquivalentMinutes)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/20">
                      <th className="px-2 py-2 font-semibold">{t(locale, 'employeeHome.timeClock.reportDate')}</th>
                      <th className="px-2 py-2 font-semibold">{t(locale, 'employeeHome.timeClock.reportSchedule')}</th>
                      <th className="px-2 py-2 font-semibold">{t(locale, 'employeeHome.timeClock.reportMarkings')}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t(locale, 'employeeHome.timeClock.reportWorked')}</th>
                      <th className="px-2 py-2 text-right font-semibold">{t(locale, 'employeeHome.timeClock.reportNightAdjusted')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day) => {
                      const nightAdjusted = day.workedMinutes - day.nightMinutes + day.nightEquivalentMinutes;
                      const markings = day.punches.map((punch) => {
                        const status = punch.voidedAt
                          ? t(locale, 'employeeHome.timeClock.reportMarkVoided')
                          : punch.source === 'manager'
                            ? t(locale, 'employeeHome.timeClock.reportMarkInserted')
                            : t(locale, 'employeeHome.timeClock.reportMarkOriginal');
                        const kind = t(locale, `employeeHome.timeClock.reportPunchKind.${punch.punchKind}`);
                        const at = new Intl.DateTimeFormat(localeHtmlLang(locale), {
                          dateStyle: 'short', timeStyle: 'short', timeZone: tz,
                        }).format(new Date(punch.punchedAt));
                        const reason = punch.voidReason || punch.notes;
                        return `${at} · ${kind} · ${status}${reason ? ` (${reason})` : ''}`;
                      });
                      for (const punch of day.preassignedMarks || []) {
                        const at = new Intl.DateTimeFormat(localeHtmlLang(locale), {
                          dateStyle: 'short', timeStyle: 'short', timeZone: tz,
                        }).format(new Date(punch.punchedAt));
                        markings.push(`${at} · ${t(locale, `employeeHome.timeClock.reportPunchKind.${punch.punchKind}`)} · ${t(locale, 'employeeHome.timeClock.reportMarkPreassigned')}`);
                      }
                      if (day.justification) {
                        markings.push(t(locale, 'employeeHome.timeClock.reportJustification', {
                          reason: t(locale, `employeeHome.timeClock.reportJustificationReason.${day.justification.reason}`),
                        }));
                      }
                      return (
                        <tr key={day.day} className="border-b border-ink/10 align-top">
                          <td className="px-2 py-2 whitespace-nowrap">{dateLabel(day.day, locale)}</td>
                          <td className="px-2 py-2">{contractLabel(day.daySchedule, locale)}</td>
                          <td className="px-2 py-2">
                            {markings.length ? markings.map((marking, index) => <div key={`${day.day}-${index}`}>{marking}</div>) : t(locale, 'employeeHome.timeClock.reportNoMarkings')}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{formatMinutesClock(day.workedMinutes)}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{formatMinutesClock(nightAdjusted)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <footer className="border-t border-ink/12 pt-3 text-xs text-ink-muted">
              <p className="m-0">{t(locale, 'employeeHome.timeClock.reportFooter')}</p>
            </footer>
          </>
        )}
      </article>
      <div className="tc-report-no-print mt-4">
        <Link href="/employee/time-clock" className="text-sm text-brand-700 underline underline-offset-2">
          {t(locale, 'employeeHome.timeClock.reportBack')}
        </Link>
      </div>
    </EmployeeDedicatedShell>
  );
}
