import { asDb } from '../ae/as-db.js';
import { ERR } from '../api-error-codes.js';
import { EMPLOYEE_NOTIF, notifyCandidates } from '../employee/employee-notifications.js';
import { getTimeClosingReadiness } from './time-clock-readiness.js';
import { parseIsoDay } from './time-day-summary.js';
import { getCompanyTimeSchedule, isoDayInTz } from './time-clock.js';
const REMINDER_BATCH = 200;
export async function remindTimeClosing(
  dbOrQuery,
  { companyId, periodStart, periodEnd, orgUnitId = null, deadline },
) {
  const db = asDb(dbOrQuery);
  const sched = await getCompanyTimeSchedule(db, { companyId });
  if (
    parseIsoDay(deadline) !== deadline ||
    deadline < isoDayInTz(new Date(), sched.schedule.timezone)
  )
    return { ok: false, errorCode: ERR.INVALID_DATE };
  const report = await getTimeClosingReadiness(db, {
    companyId,
    periodStart,
    periodEnd,
    orgUnitId,
  });
  if (!report.ok) return report;
  if (report.closed)
    return { ok: false, errorCode: ERR.TIME_CLOCK_PERIOD_CLOSED };
  // A pending decision belongs to the manager; avoid asking the employee to resubmit it.
  const people = report.items.filter(
    (p) =>
      !p.pendingRequests &&
      (p.incompleteDays || p.absenceDays || p.missingMinutes),
  );
  let inserted = 0;
  for (let i = 0; i < people.length; i += REMINDER_BATCH) {
    const result = await notifyCandidates(db, {
      companyId,
      candidateIds: people
        .slice(i, i + REMINDER_BATCH)
        .map((p) => p.candidateId),
      type: EMPLOYEE_NOTIF.TIME_CLOSING_REMINDER,
      entityType: 'time_clock_period',
      dedupeKeyPrefix: `tc_closing:${periodStart}:${periodEnd}:${deadline}`,
      payload: { from: periodStart, to: periodEnd, deadline },
    });
    inserted += result.inserted;
  }
  return { ok: true, eligible: people.length, inserted };
}
