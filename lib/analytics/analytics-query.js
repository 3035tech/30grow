const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidAnalyticsDate(value) {
  if (!value || !ISO_DATE.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidAnalyticsDateRange(startDate, endDate) {
  if (!startDate && !endDate) return true;
  if (startDate && !isValidAnalyticsDate(startDate)) return false;
  if (endDate && !isValidAnalyticsDate(endDate)) return false;
  return !startDate || !endDate || startDate <= endDate;
}

export function isValidAnalyticsMonths(months) {
  return Number.isInteger(months) && months >= 1 && months <= 24;
}
