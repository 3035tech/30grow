import { asDb } from './ae/as-db.js';
import { query } from './db.js';
import { EMPLOYEE_NOTIF } from './employee-notification-catalog.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/;
const DELIVERY_TIMEOUT_MS = 4000;
export const MOBILE_PUSH_PLATFORM = Object.freeze({ ANDROID: 'android', IOS: 'ios' });
export const MOBILE_PUSH_DESTINATION = Object.freeze({
  COMMUNITY: 'community', DP: 'dp', FEEDBACK: 'feedback', FIELD: 'field', LMS: 'lms', OKRS: 'okrs', PDI: 'pdi', TIME_CLOCK: 'time_clock', TODAY: 'today',
});
/** Screens older app builds do not have; sent only to devices that declared them (`push_destinations`, migration 153). */
export const MOBILE_PUSH_OPT_IN_DESTINATIONS = Object.freeze([MOBILE_PUSH_DESTINATION.TIME_CLOCK, MOBILE_PUSH_DESTINATION.FIELD]);
const APP_VERSION_PATTERN = /^\d{1,4}(\.\d{1,4}){0,3}([-+][0-9A-Za-z.]{1,16})?$/;

export function mobilePushDestinationFor(type) {
  if (type === EMPLOYEE_NOTIF.LMS_ENROLLED || type === EMPLOYEE_NOTIF.LMS_OVERDUE) return MOBILE_PUSH_DESTINATION.LMS;
  if (type === EMPLOYEE_NOTIF.PDI_UPDATED) return MOBILE_PUSH_DESTINATION.PDI;
  if (type === EMPLOYEE_NOTIF.DP_LEAVE_UPDATE || type === EMPLOYEE_NOTIF.DP_DOC_REMINDER || type === EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED) return MOBILE_PUSH_DESTINATION.DP;
  if (type === EMPLOYEE_NOTIF.KUDOS_RECEIVED) return MOBILE_PUSH_DESTINATION.COMMUNITY;
  if (type === EMPLOYEE_NOTIF.FEEDBACK_REQUESTED) return MOBILE_PUSH_DESTINATION.FEEDBACK;
  if (type === EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED) return MOBILE_PUSH_DESTINATION.OKRS;
  if (type === EMPLOYEE_NOTIF.TIME_REQUEST_DECIDED || type === EMPLOYEE_NOTIF.TIME_MIRROR_AVAILABLE) return MOBILE_PUSH_DESTINATION.TIME_CLOCK;
  if (type === EMPLOYEE_NOTIF.FIELD_EXPENSE_DECIDED || type === EMPLOYEE_NOTIF.FIELD_VISITS_ASSIGNED) return MOBILE_PUSH_DESTINATION.FIELD;
  return MOBILE_PUSH_DESTINATION.TODAY;
}

/** Keeps only opt-in destinations the server knows (dedupe, fixed order). */
export function normalizeMobilePushDestinations(list) {
  const wanted = new Set((Array.isArray(list) ? list : []).map((d) => String(d || '').trim()));
  return MOBILE_PUSH_OPT_IN_DESTINATIONS.filter((d) => wanted.has(d));
}

/** Opt-in destination the device did not declare → `today` (older app builds have no such screen). */
export function resolveMobilePushDestination(preferred, deviceDestinations = []) {
  const dest = String(preferred || '') || MOBILE_PUSH_DESTINATION.TODAY;
  if (!MOBILE_PUSH_OPT_IN_DESTINATIONS.includes(dest)) return dest;
  return (deviceDestinations || []).includes(dest) ? dest : MOBILE_PUSH_DESTINATION.TODAY;
}

export function normalizeMobileAppVersion(value) {
  const v = String(value ?? '').trim();
  return v && v.length <= 32 && APP_VERSION_PATTERN.test(v) ? v : null;
}

export function validExpoPushToken(value) { return EXPO_TOKEN_PATTERN.test(String(value || '').trim()); }

export async function registerMobileEmployeePushToken(dbOrQuery, { candidateId, companyId, platform, pushToken, appVersion = null, destinations = [] }) {
  const db = asDb(dbOrQuery || query);
  const token = String(pushToken || '').trim();
  if (!validExpoPushToken(token) || !Object.values(MOBILE_PUSH_PLATFORM).includes(platform)) return { ok: false };
  const declared = normalizeMobilePushDestinations(destinations);
  await db.query(
    `INSERT INTO mobile_employee_push_tokens (candidate_id, company_id, expo_push_token, platform, app_version, push_destinations)
     VALUES ($1, $2, $3, $4, $5, $6::text[])
     ON CONFLICT (expo_push_token) DO UPDATE SET candidate_id = EXCLUDED.candidate_id,
       company_id = EXCLUDED.company_id, platform = EXCLUDED.platform, active = TRUE,
       app_version = EXCLUDED.app_version, push_destinations = EXCLUDED.push_destinations,
       updated_at = NOW(), last_error = NULL`,
    [candidateId, companyId, token, platform, normalizeMobileAppVersion(appVersion), declared]
  );
  return { ok: true, destinations: declared };
}

export async function unregisterMobileEmployeePushToken(dbOrQuery, { candidateId, companyId, pushToken }) {
  const db = asDb(dbOrQuery || query);
  await db.query(
    `UPDATE mobile_employee_push_tokens SET active = FALSE, updated_at = NOW()
     WHERE candidate_id = $1 AND company_id = $2 AND expo_push_token = $3`,
    [candidateId, companyId, String(pushToken || '').trim()]
  );
  return { ok: true };
}

export async function sendMobileEmployeePush(dbOrQuery, { candidateId, companyId, destination, notificationId }) {
  const db = asDb(dbOrQuery || query);
  let tokens;
  try {
    const result = await db.query(
      `SELECT expo_push_token AS token, push_destinations AS destinations FROM mobile_employee_push_tokens
       WHERE candidate_id = $1 AND company_id = $2 AND active = TRUE LIMIT 10`,
      [candidateId, companyId]
    );
    tokens = result.rows.map((row) => ({ to: row.token, destinations: Array.isArray(row.destinations) ? row.destinations : [] }));
  } catch (error) {
    if (error?.code === '42P01') return { sent: 0 };
    throw error;
  }
  if (!tokens.length) return { sent: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  const reference = /^[1-9]\d{0,17}$/.test(String(notificationId ?? '')) ? String(notificationId) : null;
  const messages = tokens.map(({ to, destinations }) => {
    const dest = resolveMobilePushDestination(destination, destinations);
    const data = { destination: dest, url: `team30://workspace?destination=${encodeURIComponent(dest)}`, ...(reference ? { notificationId: reference } : {}) };
    return { to, title: '30 Grow', body: 'Você tem uma atualização no app.', sound: 'default', data };
  });
  try {
    const response = await fetch(EXPO_PUSH_URL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(messages), signal: controller.signal });
    if (!response.ok) throw new Error(`expo_push_${response.status}`);
    return { sent: tokens.length };
  } finally { clearTimeout(timeout); }
}
