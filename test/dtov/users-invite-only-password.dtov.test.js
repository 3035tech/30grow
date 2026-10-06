/**
 * DTOV: tenant managers never set another user's password (invite e-mail only).
 * Super admin (allowPassword / isAdmin) keeps the manual path.
 * Tenant managers also can't change another user's e-mail (account takeover via reset).
 * Run with SMTP_MOCK=1.
 */
import assert from 'node:assert/strict';
import { pool, query } from '../../lib/db.js';
import { ERR } from '../../lib/api-error-codes.js';
import { __getMailMockLog, __resetMailMockLog } from '../../lib/mail.js';
import { createUser, updateUser } from '../../lib/users-admin.js';
import { closeRateLimitRedis } from '../../lib/rate-limit.js';

async function main() {
  assert.equal(process.env.SMTP_MOCK, '1', 'run with SMTP_MOCK=1');
  const co = await query(
    `SELECT id FROM companies WHERE deleted = FALSE AND slug = 'todos-os-dados-demo' LIMIT 1`
  );
  assert.ok(co.rowCount, 'demo company missing; run dtov:reset');
  const companyId = Number(co.rows[0].id);
  const stamp = Date.now();
  const created = [];

  try {
    const denied = await createUser({
      email: `dtov-pw-denied-${stamp}@example.com`,
      password: 'Senha12345!',
      role: 'hr',
      companyId,
      allowPassword: false,
      appUrl: 'http://127.0.0.1:3010',
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.errorCode, ERR.PASSWORD_INVITE_ONLY);
    const leaked = await query(`SELECT 1 FROM users WHERE email = $1`, [`dtov-pw-denied-${stamp}@example.com`]);
    assert.equal(leaked.rowCount, 0, 'denied create must not insert');

    __resetMailMockLog();
    const invited = await createUser({
      email: `dtov-pw-invite-${stamp}@example.com`,
      role: 'hr',
      companyId,
      allowPassword: false,
      appUrl: 'http://127.0.0.1:3010',
    });
    assert.equal(invited.ok, true, invited.errorCode);
    created.push(invited.user.id);
    assert.equal(invited.user.inviteSent, true);
    assert.ok(__getMailMockLog().some((m) => m.to === `dtov-pw-invite-${stamp}@example.com`));
    const pending = await query(`SELECT password_setup_token IS NOT NULL AS pending FROM users WHERE id = $1`, [invited.user.id]);
    assert.equal(pending.rows[0].pending, true);

    const tenantEdit = await updateUser({
      userId: invited.user.id,
      body: { password: 'OutraSenha123!' },
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(tenantEdit.ok, false);
    assert.equal(tenantEdit.errorCode, ERR.PASSWORD_INVITE_ONLY);

    const tenantOtherEdit = await updateUser({
      userId: invited.user.id,
      body: { active: true, password: '' },
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(tenantOtherEdit.ok, true, tenantOtherEdit.errorCode);

    const hijackEmail = `dtov-pw-hijack-${stamp}@example.com`;
    const tenantEmail = await updateUser({
      userId: invited.user.id,
      body: { email: hijackEmail },
      actorUserId: -1,
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(tenantEmail.ok, false);
    assert.equal(tenantEmail.errorCode, ERR.EMAIL_CHANGE_SELF_ONLY);
    const unchanged = await query(`SELECT email FROM users WHERE id = $1`, [invited.user.id]);
    assert.equal(unchanged.rows[0].email, `dtov-pw-invite-${stamp}@example.com`);

    const sameEmail = await updateUser({
      userId: invited.user.id,
      body: { email: `DTOV-PW-INVITE-${stamp}@example.com`, active: true },
      actorUserId: -1,
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(sameEmail.ok, true, sameEmail.errorCode);

    const selfEmail = `dtov-pw-self-${stamp}@example.com`;
    const selfEdit = await updateUser({
      userId: invited.user.id,
      body: { email: selfEmail },
      actorUserId: invited.user.id,
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(selfEdit.ok, false);
    assert.equal(selfEdit.errorCode, ERR.EMAIL_CHANGE_PASSWORD_REQUIRED);

    const adminEmail = `dtov-pw-support-${stamp}@example.com`;
    const supportEdit = await updateUser({
      userId: invited.user.id,
      body: { email: adminEmail },
      actorUserId: -1,
      isAdmin: true,
    });
    assert.equal(supportEdit.ok, true, supportEdit.errorCode);
    const finalEmail = await query(`SELECT email FROM users WHERE id = $1`, [invited.user.id]);
    assert.equal(finalEmail.rows[0].email, adminEmail);

    const superAdmin = await createUser({
      email: `dtov-pw-admin-${stamp}@example.com`,
      password: 'Senha12345!',
      role: 'hr',
      companyId,
      appUrl: 'http://127.0.0.1:3010',
    });
    assert.equal(superAdmin.ok, true, superAdmin.errorCode);
    created.push(superAdmin.user.id);
  } finally {
    if (created.length) {
      await query(`DELETE FROM user_company_memberships WHERE user_id = ANY($1::bigint[])`, [created]).catch(() => {});
      await query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [created]).catch(() => {});
    }
  }

  console.log('users-invite-only-password.dtov.test.js OK');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRateLimitRedis().catch(() => {});
    await pool.end().catch(() => {});
  });
