import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function source(path) { return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'); }

describe('mobile employee session contract', () => {
  it('uses employee identity without manager roles or capabilities', () => {
    const session = source('lib/mobile/mobile-employee-session.js');
    assert.match(session, /EMPLOYMENT_STATUS\.EMPLOYEE/);
    assert.match(session, /candidateId/);
    assert.match(session, /companyId/);
    assert.doesNotMatch(session, /CAP\.|activeMembership|user_company_memberships/);
  });
  it('persists only refresh hashes and password-proven contexts', () => {
    const session = source('lib/mobile/mobile-employee-session.js');
    const migration = source('migrations/117_mobile_employee_refresh_sessions.sql');
    assert.match(session, /createHash\('sha256'\)/);
    assert.match(session, /FOR UPDATE/);
    assert.match(session, /allowedContexts/);
    assert.match(migration, /token_hash CHAR\(64\)/);
    assert.match(migration, /allowed_contexts JSONB/);
    assert.doesNotMatch(migration, /refresh_token\s+TEXT/i);
  });
  it('accepts only candidateId during company selection and switch', () => {
    for (const path of ['app/api/mobile/v1/session/company/select/route.js', 'app/api/mobile/v1/session/company/switch/route.js']) {
      const route = source(path);
      assert.match(route, /candidateId/);
      assert.doesNotMatch(route, /membershipId|role|capabilities/);
    }
  });
});
