import assert from 'node:assert/strict';
import test from 'node:test';

import { EMPLOYEE_NOTIF } from '../../lib/employee-notification-catalog.js';
import { MOBILE_PUSH_DESTINATION, mobilePushDestinationFor, validExpoPushToken } from '../../lib/mobile-employee-push.js';

test('accepts only Expo push token shapes', () => {
  assert.equal(validExpoPushToken('ExpoPushToken[abc_DEF-123]'), true);
  assert.equal(validExpoPushToken('https://attacker.example/token'), false);
});

test('maps notification types to a closed mobile destination', () => {
  assert.equal(mobilePushDestinationFor(EMPLOYEE_NOTIF.KUDOS_RECEIVED), MOBILE_PUSH_DESTINATION.COMMUNITY);
  assert.equal(mobilePushDestinationFor(EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED), MOBILE_PUSH_DESTINATION.DP);
  assert.equal(mobilePushDestinationFor('unknown'), MOBILE_PUSH_DESTINATION.TODAY);
});

test('B-2721: opt-in destinations fall back to today unless the device declared them', async () => {
  const { MOBILE_PUSH_OPT_IN_DESTINATIONS, normalizeMobilePushDestinations, resolveMobilePushDestination, normalizeMobileAppVersion } =
    await import('../../lib/mobile-employee-push.js');
  assert.equal(mobilePushDestinationFor(EMPLOYEE_NOTIF.TIME_REQUEST_DECIDED), MOBILE_PUSH_DESTINATION.TIME_CLOCK);
  assert.equal(mobilePushDestinationFor(EMPLOYEE_NOTIF.FIELD_EXPENSE_DECIDED), MOBILE_PUSH_DESTINATION.FIELD);
  assert.ok(MOBILE_PUSH_OPT_IN_DESTINATIONS.includes(MOBILE_PUSH_DESTINATION.TIME_CLOCK));
  assert.deepEqual(normalizeMobilePushDestinations(['time_clock', 'evil', 'time_clock', 'field']), ['time_clock', 'field']);
  assert.deepEqual(normalizeMobilePushDestinations(null), []);
  assert.equal(resolveMobilePushDestination(MOBILE_PUSH_DESTINATION.TIME_CLOCK, []), MOBILE_PUSH_DESTINATION.TODAY);
  assert.equal(resolveMobilePushDestination(MOBILE_PUSH_DESTINATION.TIME_CLOCK, ['time_clock']), MOBILE_PUSH_DESTINATION.TIME_CLOCK);
  assert.equal(resolveMobilePushDestination(MOBILE_PUSH_DESTINATION.FIELD, ['time_clock']), MOBILE_PUSH_DESTINATION.TODAY);
  assert.equal(resolveMobilePushDestination(MOBILE_PUSH_DESTINATION.DP, []), MOBILE_PUSH_DESTINATION.DP);
  assert.equal(normalizeMobileAppVersion(' 2.4.1 '), '2.4.1');
  assert.equal(normalizeMobileAppVersion('x'.repeat(40)), null);
});
