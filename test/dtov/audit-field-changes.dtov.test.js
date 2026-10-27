/**
 * DTOV: field-level audit (who + what) with LGPD minimization.
 * DP personal data → field names only; user operational fields → from/to.
 */
import assert from 'node:assert/strict';
import { pool, query } from '../../lib/db.js';
import { upsertDpProfile } from '../../lib/people/employee-dp.js';
import { updateUser } from '../../lib/identity/users-admin.js';
import { closeRateLimitRedis } from '../../lib/identity/rate-limit.js';

async function main() {
  const cand = await query(
    `SELECT c.id, c.company_id AS "companyId", d.cpf
     FROM candidates c LEFT JOIN candidate_dp_profiles d ON d.candidate_id = c.id
     WHERE c.email = 'colaborador@todos-os-dados.demo' LIMIT 1`
  );
  assert.ok(cand.rowCount, 'demo collaborator missing; run dtov:reset');
  const { id: candidateId, companyId, cpf: originalCpf } = cand.rows[0];

  const newCpf = '52998224725';
  const dp = await upsertDpProfile({ query }, { companyId, candidateId, cpf: newCpf, addressCity: 'Campinas', allowAlumni: true });
  assert.equal(dp.ok, true, dp.errorCode);
  const fields = dp.changes.map((c) => c.field).sort();
  assert.deepEqual([...fields], ['addressCity', 'cpf']);
  assert.ok(dp.changes.every((c) => !('from' in c) && !('to' in c)), 'DP changes carry no values');
  assert.ok(!JSON.stringify(dp.changes).includes(newCpf));

  const same = await upsertDpProfile({ query }, { companyId, candidateId, cpf: newCpf, allowAlumni: true });
  assert.equal(same.changes.length, 0, 'no-op save records no change');
  await upsertDpProfile({ query }, { companyId, candidateId, cpf: originalCpf || '', allowAlumni: true });

  const hr = await query(`SELECT id FROM users WHERE email = 'hr@todos-os-dados.demo' LIMIT 1`);
  const target = await query(
    `INSERT INTO users (email, password_hash, role, company_id, active)
     VALUES ($1, 'x', 'hr', $2, TRUE) RETURNING id`,
    [`dtov-audit-${Date.now()}@example.com`, companyId]
  );
  const userId = target.rows[0].id;
  try {
    const res = await updateUser({
      userId,
      body: { role: 'direction', active: false },
      actorUserId: hr.rows[0].id,
      isAdmin: false,
      scopeCompanyId: companyId,
    });
    assert.equal(res.ok, true, res.errorCode);
    const row = await query(
      `SELECT actor_user_id AS "actorUserId", company_id AS "companyId", metadata
       FROM audit_log WHERE action = 'user.update' AND target_id = $1
       ORDER BY id DESC LIMIT 1`,
      [String(userId)]
    );
    assert.equal(row.rowCount, 1);
    assert.equal(String(row.rows[0].actorUserId), String(hr.rows[0].id), 'who changed');
    assert.equal(String(row.rows[0].companyId), String(companyId));
    const changes = row.rows[0].metadata.changes;
    assert.deepEqual(changes, [
      { field: 'role', from: 'hr', to: 'direction' },
      { field: 'active', from: true, to: false },
    ]);
  } finally {
    await query(`DELETE FROM user_company_memberships WHERE user_id = $1`, [userId]).catch(() => {});
  }

  console.log('audit-field-changes.dtov.test.js OK');
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
