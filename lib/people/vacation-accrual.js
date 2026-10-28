// CLT art. 130: each completed twelve-month contract period earns an annual
// vacation entitlement. Art. 130 §2: vacation itself counts as service time.
const ANNUAL_DAYS = 30;

function iso(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
}

function addYears(day, years) {
  const d = new Date(`${day}T12:00:00Z`);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  // A 29 February anniversary falls on 28 February in a non-leap year.
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function previousDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addMonths(day, months) {
  const d = new Date(`${day}T12:00:00Z`);
  const targetDate = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(targetDate, lastDate));
  return d.toISOString().slice(0, 10);
}

function daysInclusive(start, end) {
  return Math.max(0, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1);
}

function proportionalDays(start, asOf) {
  let months = 0;
  while (months < 12) {
    if (addMonths(start, months + 1) > asOf) break;
    months += 1;
  }
  const remaining = daysInclusive(addMonths(start, months), asOf);
  return Math.min(ANNUAL_DAYS, (months + (remaining > 14 ? 1 : 0)) * (ANNUAL_DAYS / 12));
}

/** A normal CLT timeline. Exceptional absences, collective leave and rehires need HR review. */
export function calculateVacationAccrual({ startDate, asOf = new Date(), vacations = [], entitlementDays = ANNUAL_DAYS, adjustmentDays = 0 }) {
  const start = iso(startDate);
  const today = iso(asOf);
  if (!start || !today || start > today) return null;
  const periods = [];
  for (let index = 0; index < 100; index += 1) {
    const periodStart = addYears(start, index);
    if (periodStart > today) break;
    const nextStart = addYears(start, index + 1);
    const acquired = nextStart <= today;
    periods.push({
      periodStart,
      periodEnd: previousDay(nextStart),
      acquired,
      entitlementDays: index === 0 ? Number(entitlementDays) : ANNUAL_DAYS,
      adjustmentDays: index === 0 ? Number(adjustmentDays) : 0,
      usedDays: 0,
      pendingDays: 0,
      formingDays: acquired ? 0 : proportionalDays(periodStart, today),
    });
  }
  for (const vacation of [...vacations].sort((a, b) => String(a.startsOn).localeCompare(String(b.startsOn)))) {
    if (!['requested', 'approved', 'taken'].includes(vacation.status)) continue;
    const leaveStart = iso(vacation.startsOn);
    const leaveEnd = iso(vacation.endsOn);
    if (!leaveStart || !leaveEnd || leaveEnd < leaveStart || !periods.length) continue;
    let remaining = daysInclusive(leaveStart, leaveEnd);
    const field = vacation.status === 'requested' ? 'pendingDays' : 'usedDays';
    for (const period of periods) {
      if (period.periodStart > leaveStart) break;
      const free = Math.max(0, period.entitlementDays + period.adjustmentDays - period.usedDays - period.pendingDays);
      const taken = Math.min(free, remaining);
      period[field] += taken;
      remaining -= taken;
      if (!remaining) break;
    }
    if (remaining) {
      const lastEligible = periods.findLastIndex(p => p.periodStart <= leaveStart);
      periods[Math.max(0, lastEligible)][field] += remaining;
    }
  }
  for (const period of periods) {
    period.availableDays = period.acquired
      ? period.entitlementDays + period.adjustmentDays - period.usedDays - period.pendingDays
      : 0;
  }
  const acquired = periods.filter(p => p.acquired);
  return {
    periods,
    availableDays: acquired.reduce((sum, p) => sum + p.availableDays, 0),
    entitlementDays: acquired.reduce((sum, p) => sum + p.entitlementDays, 0),
    adjustmentDays: acquired.reduce((sum, p) => sum + p.adjustmentDays, 0),
    usedDays: periods.reduce((sum, p) => sum + p.usedDays, 0),
    pendingDays: periods.reduce((sum, p) => sum + p.pendingDays, 0),
    formingDays: periods.find(p => !p.acquired)?.formingDays || 0,
  };
}
