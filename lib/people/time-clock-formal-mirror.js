import { parseIsoDay } from './time-day-summary.js';

export function isValidTimeClockFormalMonth(from, to) {
  if (!/^\d{4}-\d{2}-01$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return false;
  if (parseIsoDay(from) !== from || parseIsoDay(to) !== to) return false;
  const month = from.slice(0, 7);
  if (to.slice(0, 7) !== month || to < from) return false;
  const firstDay = new Date(`${month}-01T12:00:00Z`);
  firstDay.setUTCMonth(firstDay.getUTCMonth() + 1, 0);
  const lastDay = firstDay.toISOString().slice(0, 10);
  return to <= lastDay;
}

export function missingTimeClockFormalMirrorFields(mirror, identity) {
  const missing = [];
  if (!identity?.registeredWorkerName) missing.push('workerName');
  if (!mirror?.person?.startDate) missing.push('admission');
  if (!mirror?.person?.jobRoleName) missing.push('jobRole');
  if (!identity?.cpf) missing.push('cpf');
  if (!identity?.employerName) missing.push('employerName');
  if (!identity?.employerDocument) missing.push('employerDocument');
  if (mirror?.truncated) missing.push('punchLimit');
  return missing;
}
