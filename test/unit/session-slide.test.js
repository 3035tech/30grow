/**
 * Unit smoke — sliding session window (gestor + colaborador), no DB.
 */
import assert from 'node:assert/strict';
import {
  shouldSlideSession,
  SESSION_SLIDE_WITHIN_SEC,
  MANAGER_SESSION_MAX_AGE_SEC,
} from '../../lib/session-ttl.js';
import { EMPLOYEE_SESSION_MAX_AGE } from '../../lib/employee/employee-auth-constants.js';
import { COOKIE_NAME, sessionCookieOptions } from '../../lib/session-cookie.js';

assert.equal(COOKIE_NAME, 'team30_session');
assert.equal(sessionCookieOptions({ maxAge: 10 }).maxAge, 10);
assert.equal(sessionCookieOptions({ maxAge: 10 }).httpOnly, true);
assert.equal(sessionCookieOptions({ maxAge: 10 }).sameSite, 'lax');
assert.equal(sessionCookieOptions({ maxAge: 10 }).path, '/');

const now = 1_700_000_000;

assert.equal(shouldSlideSession(now + 60, { nowSec: now }), true);
assert.equal(shouldSlideSession(now + SESSION_SLIDE_WITHIN_SEC, { nowSec: now }), true);
assert.equal(shouldSlideSession(now + SESSION_SLIDE_WITHIN_SEC + 1, { nowSec: now }), false);
assert.equal(shouldSlideSession(now + MANAGER_SESSION_MAX_AGE_SEC, { nowSec: now }), false);
assert.equal(shouldSlideSession(now + EMPLOYEE_SESSION_MAX_AGE, { nowSec: now }), false);
assert.equal(shouldSlideSession(now - 1, { nowSec: now }), false);
assert.equal(shouldSlideSession(null, { nowSec: now }), false);
assert.equal(shouldSlideSession(Number.NaN, { nowSec: now }), false);
assert.equal(
  shouldSlideSession(now + 100, { nowSec: now, withinSec: 50 }),
  false,
  'custom withinSec'
);

console.log('session-slide.test.js: ok');
