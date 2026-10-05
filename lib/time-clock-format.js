/** Pure time-clock formatters (safe for client components). */

/** Per-request caps for a day adjustment (manager mirror and employee request). */
export const TIME_ADJUST_MAX_ADD = 8;
export const TIME_ADJUST_MAX_VOID = 12;

/** 65 → "1h05", -65 → "-1h05". */
export function formatMinutesHm(totalMinutes) {
  const n = Math.round(Number(totalMinutes) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, '0')}`;
}

/** 65 → "01:05", -997 → "-16:37" (mirror / balance columns). */
export function formatMinutesClock(totalMinutes) {
  const n = Math.round(Number(totalMinutes) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Calendar YYYY-MM-DD in the browser's local zone. */
export function localIsoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftIsoDay(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Mirror / history period presets: '7' | '30' | 'month' | 'prevMonth'. */
export function timeClockPeriodFor(preset, today = localIsoToday()) {
  if (preset === '7') return { from: shiftIsoDay(today, -6), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === 'prevMonth') {
    const lastPrev = shiftIsoDay(`${today.slice(0, 8)}01`, -1);
    return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
  }
  return { from: shiftIsoDay(today, -29), to: today };
}

/** HH:mm of an instant in an IANA zone (company schedule), for display and edit forms. */
export function hmInZone(value, timeZone) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value || '00';
    const m = parts.find((p) => p.type === 'minute')?.value || '00';
    return `${h === '24' ? '00' : h}:${m}`;
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Minutes between two HH:mm (0 when invalid or reversed). */
export function hmSpanMinutes(start, end) {
  const toMin = (hm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(start);
  const b = toMin(end);
  return a == null || b == null || b <= a ? 0 : b - a;
}

/**
 * Valid punch coordinates or null (collaborator punches must carry a location).
 * @returns {{ latitude: number, longitude: number } | null}
 */
export function parsePunchCoordinates(latitude, longitude) {
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const la = num(latitude);
  const lo = num(longitude);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { latitude: la, longitude: lo };
}
