import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { validateFormFields } from '../../lib/form-validation.js';

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('employee company switch contract', () => {
  it('requires an employee session and reauthenticates only a same-email target', () => {
    const route = source('app/api/employee/companies/route.js');
    assert.match(route, /getEmployeeSessionPayload/);
    assert.match(route, /findEmployeesByEmail\(query, \{ email: session\.email \}\)/);
    assert.match(route, /loginEmployeeWithPassword\(query, \{/);
    assert.match(route, /email: session\.email/);
    assert.match(route, /choices\.some/);
    assert.match(route, /employee-company-switch:/);
  });

  it('replaces the session, preserves target 2FA and audits the switch', () => {
    const route = source('app/api/employee/companies/route.js');
    assert.match(route, /verifyEmployee2faLogin/);
    assert.match(route, /buildEmployeeLoginResponse/);
    assert.match(route, /auditAction: 'auth\.company_switch'/);
    assert.match(route, /fromCompanyId/);
  });

  it('exposes the action contextually in the existing employee profile menu', () => {
    const topBar = source('app/_components/EmployeeTopBar.jsx');
    assert.match(topBar, /fetch\('\/api\/employee\/companies', \{ cache: 'no-store' \}\)/);
    assert.match(topBar, /employeeHome\.switchCompany/);
    assert.match(topBar, /companyChoices\.length > 1/);
    assert.match(topBar, /cache: 'no-store'/);
    assert.match(topBar, /employeeHome\.checkingCompanies/);
    assert.match(topBar, /window\.location\.assign\('\/employee'\)/);
  });

  it('validates missing credentials on submit and accepts completed credentials', () => {
    const fields = [
      { key: 'password', type: 'password', required: true },
      { key: 'totp', required: true },
    ];
    const missing = validateFormFields(fields, { password: '', totp: '' }, 'pt-BR');
    assert.deepEqual(Object.keys(missing), ['password', 'totp']);
    const partial = validateFormFields(fields, { password: 'LocalTest!2026', totp: '' }, 'pt-BR');
    assert.deepEqual(Object.keys(partial), ['totp']);
    assert.deepEqual(validateFormFields(fields, { password: 'LocalTest!2026', totp: '123456' }, 'pt-BR'), {});
  });
});
