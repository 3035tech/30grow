/** DTOV proof — signup and password activation preserve membership parity. */
import assert from 'node:assert/strict';
import { pool, query } from '../../lib/db.js';
import { closeRateLimitRedis } from '../../lib/identity/rate-limit.js';
import {
  createSelfServiceSignupIdentity,
  SELF_SERVICE_COMPANY_ACTION,
} from '../../lib/identity/self-service-signup.js';
import { completePasswordSetup, hashUnusablePassword, issuePasswordSetupInvite } from '../../lib/identity/user-password-invite.js';
import { hydrateSessionPayload } from '../../lib/identity/session.js';
import { CAP, can, canManageCompanyModules } from '../../lib/identity/permissions.js';
import { deactivateUser, listUsers, resendUserPasswordInvite, updateUser } from '../../lib/identity/users-admin.js';

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `membership-signup-${suffix}@dtov.test`;
  let userId = null;
  let joinerId = null;
  let tenantAdminId = null;
  let companyId = null;

  try {
    const created = await createSelfServiceSignupIdentity({
      companyAction: SELF_SERVICE_COMPANY_ACTION.CREATE,
      companyName: `DTOV Signup Membership ${suffix}`,
      companySlug: `dtov-signup-membership-${suffix}`,
      email,
      passwordHash: await hashUnusablePassword(),
      locale: 'pt-BR',
      signupMetadata: {
        companyName: `DTOV Signup Membership ${suffix}`,
        fullName: 'DTOV Membership Owner',
      },
    });
    userId = created.userId;
    companyId = created.companyId;
    const issued = await issuePasswordSetupInvite(userId, {
      appUrl: 'http://127.0.0.1:3210',
      locale: 'pt-BR',
      purpose: 'invite',
    });
    assert.equal(issued.ok, true);

    const pending = await query(
      `SELECT
         u.id AS "userId",
         u.company_id AS "companyId",
         u.role AS "userRole",
         u.active AS "userActive",
         u.password_setup_token AS "setupToken",
         m.role AS "membershipRole",
         m.active AS "membershipActive",
         m.deleted AS "membershipDeleted"
       FROM users u
       JOIN user_company_memberships m
         ON m.user_id = u.id AND m.company_id = u.company_id
       WHERE LOWER(u.email) = $1`,
      [email]
    );
    assert.equal(pending.rowCount, 1);
    const row = pending.rows[0];
    assert.equal(row.userRole, 'direction');
    assert.equal(row.membershipRole, row.userRole);
    assert.equal(row.userActive, false);
    assert.equal(row.membershipActive, false);
    assert.equal(row.membershipDeleted, false);
    assert.ok(String(row.setupToken).length >= 16);

    const activated = await completePasswordSetup(row.setupToken, 'MembershipSignup!2026');
    assert.equal(activated.ok, true);
    assert.equal(Number(activated.userId), Number(userId));

    const active = await query(
      `SELECT u.active AS "userActive", u.signup_pending AS "signupPending",
              m.active AS "membershipActive", m.deleted AS "membershipDeleted"
       FROM users u
       JOIN user_company_memberships m
         ON m.user_id = u.id AND m.company_id = u.company_id
       WHERE u.id = $1`,
      [userId]
    );
    assert.equal(active.rowCount, 1);
    assert.deepEqual(active.rows[0], {
      userActive: true,
      signupPending: false,
      membershipActive: true,
      membershipDeleted: false,
    });

    const joiner = await query(
      `INSERT INTO users (email, password_hash, role, active, company_id)
       VALUES ($1, $2, 'hr', TRUE, $3)
       RETURNING id, session_version AS "sv"`,
      [`membership-joiner-${suffix}@dtov.test`, await hashUnusablePassword(), companyId]
    );
    joinerId = joiner.rows[0].id;
    const ownerSv = await query(`SELECT session_version AS "sv" FROM users WHERE id = $1`, [userId]);
    const ownerSession = await hydrateSessionPayload({ userId, sv: ownerSv.rows[0].sv });
    const joinerSession = await hydrateSessionPayload({ userId: joinerId, sv: joiner.rows[0].sv });
    assert.equal(ownerSession.companyOwner, true);
    assert.equal(joinerSession.companyOwner, false);
    assert.equal(can(ownerSession, CAP.USERS_MANAGE), true);
    assert.equal(can(joinerSession, CAP.USERS_MANAGE), false);
    assert.equal(canManageCompanyModules(ownerSession), true);
    assert.equal(canManageCompanyModules(joinerSession), false);

    const tenantAdmin = await query(
      `INSERT INTO users (email, password_hash, role, active, company_id)
       VALUES ($1, $2, 'admin', TRUE, $3) RETURNING id`,
      [`membership-tadmin-${suffix}@dtov.test`, await hashUnusablePassword(), companyId]
    );
    tenantAdminId = tenantAdmin.rows[0].id;
    const ownerScope = { isAdmin: false, scopeCompanyId: Number(companyId), actorUserId: userId };
    const listed = await listUsers({ isAdmin: false, companyId: Number(companyId), pageSize: 50 });
    assert.equal(listed.items.some((u) => String(u.id) === String(tenantAdminId)), false);
    assert.equal(listed.items.some((u) => String(u.id) === String(joinerId)), true);
    const demote = await updateUser({ userId: tenantAdminId, body: { role: 'hr' }, ...ownerScope });
    assert.equal(demote.ok, false);
    const deactivate = await deactivateUser({ userId: tenantAdminId, ...ownerScope });
    assert.equal(deactivate.ok, false);
    const resend = await resendUserPasswordInvite({ userId: tenantAdminId, appUrl: 'http://127.0.0.1:3210', ...ownerScope });
    assert.equal(resend.ok, false);
    const stillAdmin = await query(`SELECT role, active FROM users WHERE id = $1`, [tenantAdminId]);
    assert.deepEqual(stillAdmin.rows[0], { role: 'admin', active: true });
    const editJoiner = await updateUser({ userId: joinerId, body: { role: 'direction' }, ...ownerScope });
    assert.equal(editJoiner.ok, true);
  } finally {
    if (tenantAdminId) await query(`DELETE FROM users WHERE id = $1`, [tenantAdminId]).catch(() => {});
    if (joinerId) await query(`DELETE FROM users WHERE id = $1`, [joinerId]).catch(() => {});
    if (userId) await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    if (companyId) await query(`DELETE FROM companies WHERE id = $1`, [companyId]).catch(() => {});
    await closeRateLimitRedis().catch(() => {});
    await pool.end().catch(() => {});
  }

  console.log('user-company-membership-signup.dtov.test.js OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
