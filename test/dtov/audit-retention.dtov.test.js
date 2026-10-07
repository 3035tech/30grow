import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { purgeAuditLog } from '../../lib/audit-retention.js';
import { listAuditLogEntries } from '../../lib/audit-log-admin.js';
// Fixed local-only DTOV connection. This test never reads production configuration.
const client = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only' });
await client.connect();
try {
  await client.query('BEGIN');
  const db = { query: client.query.bind(client), withTransaction: (fn) => fn(client) };
  const companies = [];
  for (const suffix of ['a', 'b', 'held', 'unconfigured']) {
    const result = await client.query('INSERT INTO companies(name,slug) VALUES ($1,$2) RETURNING id', [`Audit test ${suffix}`, `audit-test-${suffix}-${Date.now()}`]);
    companies.push(result.rows[0].id);
  }
  for (const companyId of companies.slice(0,3)) await client.query(`INSERT INTO audit_retention_policies(company_id,retention_days,security_retention_days,approval_reference,legal_hold,hold_reference) VALUES ($1,30,90,'test-approval',$2,$3)`, [companyId, companyId === companies[2], companyId === companies[2] ? 'test-hold' : null]);
  for (const companyId of companies) {
    for (const [action, days] of [['dp.profile.updated',40],['auth.login',40],['auth.login',100],['audit.retention.policy',100],['dp.profile.updated',5]]) {
      await client.query(`INSERT INTO audit_log(actor_kind,company_id,action,created_at) VALUES ('system',$1,$2,NOW()-($3 * INTERVAL '1 day'))`, [companyId,action,days]);
    }
  }
  await client.query(`INSERT INTO audit_log(actor_kind,company_id,action,created_at) VALUES ('system',NULL,'auth.login',NOW()-INTERVAL '1000 days')`);
  const before = (await client.query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n;
  const preview = await purgeAuditLog(db);
  assert.equal(preview.dryRun,true); assert.equal(preview.eligible,4); assert.equal(preview.deleted,0); assert.equal(preview.heldCompanies,1);
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM audit_log')).rows[0].n,before);
  const result = await purgeAuditLog(db,{dryRun:false});
  assert.equal(result.deleted,4);
  for (const companyId of companies.slice(0,2)) {
    const rows = await client.query('SELECT action FROM audit_log WHERE company_id=$1',[companyId]);
    assert.deepEqual(rows.rows.map((r)=>r.action).sort(),['audit.retention.policy','auth.login','dp.profile.updated']);
  }
  for (const companyId of companies.slice(2)) assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM audit_log WHERE company_id=$1',[companyId])).rows[0].n,5);
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM audit_log WHERE company_id IS NULL')).rows[0].n,1);
  assert.equal((await purgeAuditLog(db,{dryRun:false})).deleted,0);
  // Reapply expand migration: approved policies and old events remain present.
  await client.query(await readFile(new URL('../../migrations/156_audit_retention_policies.sql',import.meta.url),'utf8'));
  assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM audit_retention_policies')).rows[0].n,3);
  const tenant = await listAuditLogEntries(db,{companyId:String(companies[0]),action:'auth.login'});
  assert.equal(tenant.items.length,1); assert.equal(Number(tenant.items[0].companyId),Number(companies[0]));
  // Constraints must reject shorter security retention and holds without reference.
  for (const sql of ["UPDATE audit_retention_policies SET security_retention_days=1", "UPDATE audit_retention_policies SET legal_hold=TRUE,hold_reference=NULL"]) {
    await client.query('SAVEPOINT invalid_policy');
    await assert.rejects(client.query(sql), (e)=>e.code==='23514');
    await client.query('ROLLBACK TO SAVEPOINT invalid_policy');
  }
  await client.query(`INSERT INTO audit_log(actor_kind,company_id,action,created_at) SELECT 'system',$1,'dp.bulk_test',NOW()-INTERVAL '40 days' FROM generate_series(1,5001)`, [companies[0]]);
  const limited = await purgeAuditLog(db, { dryRun: false });
  assert.equal(limited.deleted, 5000); assert.equal(limited.truncated, true);
  const resumed = await purgeAuditLog(db, { dryRun: false, afterCompanyId: limited.nextCompanyId });
  assert.equal(resumed.deleted, 1);
  console.log('Audit retention DTOV passed: scoped deletion, security window, hold, dry-run, replay and migration reapplication.');
} finally { await client.query('ROLLBACK'); await client.end(); }
