import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('user company membership dual-write', () => {
  it('keeps admin user create, update, and deactivate atomic with memberships', () => {
    const users = source('lib/identity/users-admin.js');
    assert.match(users, /withTransaction/);
    assert.match(users, /syncLegacyUserMembership/);
    assert.match(users, /deactivateUserMemberships/);
  });

  it('owns membership writes in one domain module', () => {
    const memberships = source('lib/identity/user-company-memberships.js');
    assert.match(memberships, /ON CONFLICT \(user_id, company_id\) DO UPDATE/);
    assert.match(memberships, /previousCompanyId/);
    assert.match(memberships, /listUserCompanyMemberships/);
    assert.doesNotMatch(memberships, /SELECT \*/);
  });

  it('keeps self-service signup company, user, and membership in one transaction', () => {
    const signup = source('app/api/auth/signup/route.js');
    const signupService = source('lib/identity/self-service-signup.js');
    assert.match(signup, /createSelfServiceSignupIdentity/);
    assert.match(signup, /SELF_SERVICE_COMPANY_ACTION/);
    assert.match(signupService, /withTransaction/);
    assert.match(signupService, /syncLegacyUserMembership/);
    assert.match(signupService, /signup_creator_user_id/);
  });

  it('activates the membership atomically when password setup completes', () => {
    const passwordInvite = source('lib/identity/user-password-invite.js');
    assert.match(passwordInvite, /withTransaction/);
    assert.match(passwordInvite, /syncLegacyUserMembership/);
  });
});
