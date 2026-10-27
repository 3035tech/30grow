import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPasswordInviteMail } from '../../lib/user-access-mail.js';
import { PASSWORD_SETUP_TTL_MS } from '../../lib/identity/user-password-invite.js';

const base = { email: 'ana@empresa.example', displayName: '<Ana> Silva', setupUrl: 'https://app.example/employee/set-password?token=abc&other=1' };
test('employee welcome has corporate access, setup and permanent portal links in every locale', () => {
  assert.equal(PASSWORD_SETUP_TTL_MS / 3600000, 72);
  for (const locale of ['pt-BR', 'pt-PT', 'en', 'fr-FR', 'de-DE', 'es-419', 'es-ES']) {
    const mail = buildUserPasswordInviteMail({ ...base, locale, employee: { companyLabel: '<Empresa>', portalUrl: 'https://app.example/employee/login' } });
    assert.ok(mail.subject.includes('<Empresa>'));
    assert.ok(mail.text.includes(base.email));
    assert.ok(mail.text.includes(base.setupUrl));
    assert.ok(mail.text.includes('https://app.example/employee/login'));
    assert.ok(mail.text.includes('72'));
    assert.ok(mail.html.includes('&lt;Empresa&gt;'));
    assert.ok(mail.html.includes('&lt;Ana&gt;'));
    assert.ok(mail.html.includes('token=abc&amp;other=1'));
    assert.doesNotMatch(mail.html, /<Empresa>|<Ana>|employeeInvite\./);
  }
});
test('manager invitation and employee password reset retain their existing messages', () => {
  const manager = buildUserPasswordInviteMail(base);
  const reset = buildUserPasswordInviteMail({ ...base, purpose: 'reset' });
  assert.doesNotMatch(manager.text, /employee\/login/);
  assert.doesNotMatch(reset.text, /employee\/login/);
  assert.notEqual(manager.subject, reset.subject);
});
