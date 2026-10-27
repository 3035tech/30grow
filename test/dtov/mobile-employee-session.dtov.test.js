import assert from 'node:assert/strict';
import { hashPassword } from '../../lib/identity/auth.js';
import { pool, query } from '../../lib/db.js';
import { completeEmployeeCompanyPick, loginEmployeeWithPassword } from '../../lib/employee/employee-auth.js';
import {
  authenticateMobileEmployee,
  completeMobileEmployeeAuthentication,
  contextsFromSelectionToken,
  refreshMobileEmployeeSession,
  switchMobileEmployeeCompany,
} from '../../lib/mobile/mobile-employee-session.js';

async function main() {
  process.env.JWT_SECRET ||= 'dtov-mobile-employee-secret-2026-minimum';
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `mobile-employee-${suffix}@dtov.test`;
  const password = 'MobileEmployee!2026';
  const companyIds = [];
  try {
    for (const marker of ['a', 'b', 'outside']) {
      const result = await query(`INSERT INTO companies (name, slug, active, deleted) VALUES ($1, $2, TRUE, FALSE) RETURNING id`, [`Employee DTOV ${marker}`, `employee-dtov-${marker}-${suffix}`]);
      companyIds.push(Number(result.rows[0].id));
    }
    const passwordHash = await hashPassword(password);
    const inserted = await query(
      `INSERT INTO candidates (company_id, full_name, email, employment_status, password_hash)
       VALUES ($1, 'Pessoa A', $4, 'employee', $5), ($2, 'Pessoa B', $4, 'employee', $5),
              ($3, 'Pessoa externa', $6, 'employee', $5)
       RETURNING id, company_id AS "companyId"`,
      [companyIds[0], companyIds[1], companyIds[2], email, passwordHash, `outside-${email}`]
    );
    const first = inserted.rows.find((row) => Number(row.companyId) === companyIds[0]);
    const second = inserted.rows.find((row) => Number(row.companyId) === companyIds[1]);
    const login = await loginEmployeeWithPassword(query, { email, password });
    assert.equal(login.ok, true);
    assert.equal(login.needsCompanyPick, true);
    assert.equal(login.companies.length, 2);
    const contexts = contextsFromSelectionToken(login.pickToken);
    const selected = await completeEmployeeCompanyPick(query, { pickToken: login.pickToken, candidateId: first.id });
    const authenticated = await completeMobileEmployeeAuthentication(selected, contexts);
    assert.equal(authenticated.ok, true);
    assert.equal(authenticated.session.activeContext.company.id, companyIds[0]);
    assert.equal(authenticated.session.availableContexts.length, 2);
    const switched = await switchMobileEmployeeCompany(authenticated.session.tokens.accessToken, authenticated.session.tokens.refreshToken, second.id);
    assert.equal(switched.ok, true);
    assert.equal(switched.session.activeContext.company.id, companyIds[1]);
    assert.equal(await authenticateMobileEmployee(authenticated.session.tokens.accessToken), null);
    const replay = await refreshMobileEmployeeSession(authenticated.session.tokens.refreshToken);
    assert.equal(replay.ok, false);
  } finally {
    if (companyIds.length) await query(`DELETE FROM companies WHERE id = ANY($1::bigint[])`, [companyIds]).catch(() => {});
    await pool.end().catch(() => {});
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
