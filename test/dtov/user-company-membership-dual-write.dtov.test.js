/** DTOV proof — admin user CRUD keeps legacy fields and memberships atomic. */
import assert from 'node:assert/strict';
import { pool, query } from '../../lib/db.js';
import { closeRateLimitRedis } from '../../lib/identity/rate-limit.js';
import { createUser, deactivateUser, updateUser } from '../../lib/identity/users-admin.js';

async function main() {
  const suffix = Date.now();
  const companyIds = [];
  let userId = null;

  try {
    for (const marker of ['a', 'b']) {
      const company = await query(
        `INSERT INTO companies (name, slug, active, deleted)
         VALUES ($1, $2, TRUE, FALSE)
         RETURNING id`,
        [`DTOV Membership ${marker}`, `dtov-membership-${marker}-${suffix}`]
      );
      companyIds.push(company.rows[0].id);
    }

    const created = await createUser({
      email: `membership-${suffix}@dtov.test`,
      password: 'MembershipTest!2026',
      role: 'hr',
      companyId: companyIds[0],
      actorUserId: null,
    });
    assert.equal(created.ok, true, created.errorCode);
    userId = created.user.id;

    const afterCreate = await query(
      `SELECT u.company_id AS "legacyCompanyId", u.role AS "legacyRole",
              m.company_id AS "membershipCompanyId", m.role AS "membershipRole",
              m.active, m.deleted
       FROM users u
       JOIN user_company_memberships m ON m.user_id = u.id AND m.company_id = u.company_id
       WHERE u.id = $1`,
      [userId]
    );
    assert.equal(afterCreate.rowCount, 1);
    assert.equal(Number(afterCreate.rows[0].legacyCompanyId), Number(companyIds[0]));
    assert.equal(afterCreate.rows[0].membershipRole, afterCreate.rows[0].legacyRole);
    assert.equal(afterCreate.rows[0].active, true);
    assert.equal(afterCreate.rows[0].deleted, false);

    const updated = await updateUser({
      userId,
      body: { companyId: companyIds[1], role: 'direction', active: true },
      actorUserId: null,
      isAdmin: true,
    });
    assert.equal(updated.ok, true, updated.errorCode);

    const afterUpdate = await query(
      `SELECT company_id AS "companyId", role, active, deleted
       FROM user_company_memberships
       WHERE user_id = $1
       ORDER BY company_id ASC`,
      [userId]
    );
    assert.equal(afterUpdate.rowCount, 2);
    const oldMembership = afterUpdate.rows.find(
      (row) => Number(row.companyId) === Number(companyIds[0])
    );
    const newMembership = afterUpdate.rows.find(
      (row) => Number(row.companyId) === Number(companyIds[1])
    );
    assert.deepEqual(
      { active: oldMembership.active, deleted: oldMembership.deleted },
      { active: false, deleted: true }
    );
    assert.deepEqual(
      { role: newMembership.role, active: newMembership.active, deleted: newMembership.deleted },
      { role: 'direction', active: true, deleted: false }
    );

    const deactivated = await deactivateUser({
      userId,
      actorUserId: null,
      isAdmin: true,
    });
    assert.equal(deactivated.ok, true, deactivated.errorCode);
    const afterDeactivate = await query(
      `SELECT COUNT(*) FILTER (WHERE active = TRUE OR deleted = FALSE)::int AS "notDeleted"
       FROM user_company_memberships
       WHERE user_id = $1`,
      [userId]
    );
    assert.equal(afterDeactivate.rows[0].notDeleted, 0);
  } finally {
    if (userId) {
      await query(`DELETE FROM user_capability_overrides WHERE user_id = $1`, [userId]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    if (companyIds.length) {
      await query(`DELETE FROM companies WHERE id = ANY($1::bigint[])`, [companyIds]).catch(() => {});
    }
    await closeRateLimitRedis().catch(() => {});
    await pool.end().catch(() => {});
  }

  console.log('user-company-membership-dual-write.dtov.test.js OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
