/** Shared readiness check for the company point-setup guide. */
function timeInMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

export function isTimeClockScheduleReady(schedule) {
  if (!schedule) return false;
  const start = timeInMinutes(schedule.workdayStart);
  const end = timeInMinutes(schedule.workdayEnd);
  const breakMinutes = Number(schedule.breakMinutes);
  if (
    start === null ||
    end === null ||
    end <= start ||
    !Number.isInteger(breakMinutes) ||
    breakMinutes < 0 ||
    breakMinutes > 240
  )
    return false;
  const breakStart = schedule.breakStart ? timeInMinutes(schedule.breakStart) : null;
  const breakEnd = schedule.breakEnd ? timeInMinutes(schedule.breakEnd) : null;
  if (Boolean(schedule.breakStart) !== Boolean(schedule.breakEnd)) return false;
  if (schedule.breakPreassigned && (!breakStart || !breakEnd || breakMinutes <= 0)) return false;
  if (
    breakStart !== null &&
    (breakStart <= start || breakEnd <= breakStart || breakEnd >= end || breakEnd - breakStart !== breakMinutes)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }).format(0);
  } catch {
    return false;
  }
  return true;
}

export function isTimeClockSetupReady(data) {
  const establishments = Array.isArray(data?.establishments) ? data.establishments : [];
  const establishmentReady = establishments.length > 0 && establishments.every((item) => item.setupValid === true);
  return establishmentReady && Boolean(data?.scheduleConfigured)
    && Number(data?.unregisteredWorkers) === 0 && Number(data?.incompleteWorkerProfiles) === 0;
}
