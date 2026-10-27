/**
 * Unit smoke — employee session JWT + magic token shape (no DB).
 */
import assert from 'node:assert/strict';
import {
  EMPLOYEE_KIND,
  EMPLOYEE_COOKIE_NAME,
  generateEmployeeMagicToken,
  signEmployeeToken,
  verifyEmployeeToken,
  isEmployeeSessionPayload,
  isValidEmployeeEmail,
} from '../../lib/employee/employee-auth.js';
import { EMPLOYEE_COOKIE_NAME as COOKIE_CONST } from '../../lib/employee/employee-auth-constants.js';

assert.equal(EMPLOYEE_COOKIE_NAME, 'team30_employee_session');
assert.equal(COOKIE_CONST, EMPLOYEE_COOKIE_NAME);
assert.equal(EMPLOYEE_KIND, 'employee');
assert.equal(isValidEmployeeEmail('a@b.com'), true);
assert.equal(isValidEmployeeEmail('nope'), false);

const magic = generateEmployeeMagicToken();
assert.ok(magic.length >= 20);

const jwt = signEmployeeToken({
  candidateId: 42,
  companyId: 7,
  email: 'colab@example.com',
  locale: 'en',
  sv: 3,
});
const payload = verifyEmployeeToken(jwt);
assert.ok(isEmployeeSessionPayload(payload));
assert.equal(payload.candidateId, 42);
assert.equal(payload.companyId, 7);
assert.equal(payload.email, 'colab@example.com');
assert.equal(payload.locale, 'en');
assert.equal(payload.sv, 3);
assert.equal(payload.kind, EMPLOYEE_KIND);

assert.equal(verifyEmployeeToken('not-a-jwt'), null);
assert.equal(isEmployeeSessionPayload(null), false);

console.log('employee-auth.test.js OK');
