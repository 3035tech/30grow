/** Import proof against disposable DTOV PostgreSQL only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dtovEnv, assertDtovTarget } from './harness.js';

const env = dtovEnv({ PGOPTIONS: '-c grow.billing_mode=test' });
assertDtovTarget(env);
Object.assign(process.env, env);

const { query, pool } = await import('../../lib/db.js');
const { previewEmployeeCsv, importEmployeeCsv } = await import('../../lib/employee-csv-import.js');
const mail = await import('../../lib/mail.js');
const { closeRateLimitRedis } = await import('../../lib/rate-limit.js');
const suffix = randomUUID().slice(0, 8);
const header = 'nome_completo,email_corporativo,data_admissao,email_pessoal\n';
const company = async name => Number((await query(
  'INSERT INTO companies(name,slug) VALUES($1,$2) RETURNING id',
  [name, `csv-${suffix}-${name.toLowerCase().replace(/\s/g, '-')}`]
)).rows[0].id);

try {
  const companyId = await company('CSV Main');
  const otherCompanyId = await company('CSV Other');
  const shared = `shared-${suffix}@example.test`;
  await query('INSERT INTO candidates(company_id,full_name,email) VALUES($1,$2,$3)', [otherCompanyId, 'Other tenant', shared]);

  const good = `${header}Ana Maria,${shared},2020-01-01,\nBia Costa,bia-${suffix}@example.test,2021-03-15,bia-personal-${suffix}@example.test\n`;
  const preview = await previewEmployeeCsv({ companyId, csv: good });
  assert.equal(preview.ok, true);
  assert.equal(preview.preview.canImport, true, 'same email in another company is allowed');

  mail.__resetMailMockLog();
  const imported = await importEmployeeCsv({ companyId, csv: good, actorId: null });
  assert.equal(imported.ok, true);
  assert.equal(imported.total, 2);
  assert.equal(mail.__getMailMockLog().length, 0, 'import must not send invitations');
  const people = await query(`SELECT email,personal_email,employment_status,start_date::text AS start_date,consent_at
    FROM candidates WHERE company_id=$1 AND email IN ($2,$3) ORDER BY email`,
    [companyId, shared, `bia-${suffix}@example.test`]);
  assert.equal(people.rowCount, 2);
  assert.ok(people.rows.every(row => row.employment_status === 'employee' && row.consent_at == null));
  assert.equal(people.rows[0].personal_email, `bia-personal-${suffix}@example.test`);
  assert.equal(people.rows[0].start_date, '2021-03-15');
  assert.equal(people.rows[1].personal_email, null);

  const repeated = await importEmployeeCsv({ companyId, csv: good, actorId: null });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.preview.invalid, 2);
  assert.equal((await query("SELECT count(*)::int AS n FROM candidates WHERE company_id=$1 AND employment_status='employee'", [companyId])).rows[0].n, 2);

  const candidateEmail = `candidate-${suffix}@example.test`;
  await query('INSERT INTO candidates(company_id,full_name,email,hr_notes) VALUES($1,$2,$3,$4)',
    [companyId, 'Existing candidate', candidateEmail, 'Private note']);
  const mixed = `${header}New Person,new-${suffix}@example.test,2020-01-01,\nCandidate,${candidateEmail},2020-01-01,\n`;
  const blocked = await importEmployeeCsv({ companyId, csv: mixed, actorId: null });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.preview.invalid, 1);
  assert.equal((await query('SELECT count(*)::int AS n FROM candidates WHERE company_id=$1 AND email=$2', [companyId, `new-${suffix}@example.test`])).rows[0].n, 0, 'known conflict leaves entire batch unchanged');
  assert.equal((await query('SELECT employment_status,hr_notes FROM candidates WHERE company_id=$1 AND email=$2', [companyId, candidateEmail])).rows[0].hr_notes, 'Private note');

  const concurrentCsv = `${header}Concurrent Person,concurrent-${suffix}@example.test,2020-01-01,\n`;
  const concurrent = await Promise.all([
    importEmployeeCsv({ companyId, csv: concurrentCsv, actorId: null }),
    importEmployeeCsv({ companyId, csv: concurrentCsv, actorId: null }),
  ]);
  assert.deepEqual(concurrent.map(item => item.ok).sort(), [false, true], 'concurrent repeats create one person');
  assert.equal((await query('SELECT count(*)::int AS n FROM candidates WHERE company_id=$1 AND email=$2', [companyId, `concurrent-${suffix}@example.test`])).rows[0].n, 1);

  const sampleCompanyId = await company('CSV Realistic');
  const sample = readFileSync(new URL('../fixtures/employee-csv-rh-sintetico.csv', import.meta.url), 'utf8');
  const samplePreview = await previewEmployeeCsv({ companyId: sampleCompanyId, csv: sample });
  assert.equal(samplePreview.ok, true);
  assert.equal(samplePreview.preview.total, 6);
  assert.equal(samplePreview.preview.canImport, true);
  mail.__resetMailMockLog();
  const sampleImport = await importEmployeeCsv({ companyId: sampleCompanyId, csv: sample, actorId: null });
  assert.equal(sampleImport.ok, true);
  assert.equal(sampleImport.total, 6);
  assert.equal(mail.__getMailMockLog().length, 0);
  const sampleRows = await query("SELECT full_name, email, personal_email, start_date::text AS start_date FROM candidates WHERE company_id=$1 AND employment_status='employee'", [sampleCompanyId]);
  assert.equal(sampleRows.rowCount, 6);
  assert.ok(sampleRows.rows.some(row => row.full_name === 'Débora Araújo' && row.start_date === '2022-09-02'));
  assert.ok(sampleRows.rows.some(row => row.email === 'bruno.lima@empresa.example.test' && row.personal_email == null));

  // Managed 20-person plan: preview and confirmation reject rows over capacity.
  await query(`INSERT INTO company_billing_terms(company_id,managed,trial_ends_at) VALUES($1,TRUE,now())
    ON CONFLICT(company_id) DO UPDATE SET managed=TRUE`, [companyId]);
  await query(`INSERT INTO company_billing_accounts(company_id,livemode,plan_key,status,period_end)
    VALUES($1,FALSE,'brl_small_monthly','active',now()+interval '30 days')
    ON CONFLICT(company_id,livemode) DO UPDATE SET plan_key='brl_small_monthly',status='active',period_end=now()+interval '30 days'`, [companyId]);
  const tooMany = `${header}${Array.from({ length: 18 }, (_, i) => `Person ${i},p${i}-${suffix}@example.test,2020-01-01,`).join('\n')}\n`;
  const capacity = await previewEmployeeCsv({ companyId, csv: tooMany });
  assert.equal(capacity.preview.capacity.exceeded, true);
  assert.equal((await importEmployeeCsv({ companyId, csv: tooMany, actorId: null })).ok, false);
  assert.equal((await query("SELECT count(*)::int AS n FROM candidates WHERE company_id=$1 AND employment_status='employee'", [companyId])).rows[0].n, 3);
  process.stdout.write('employee CSV import DTOV: ok\n');
} finally {
  await pool.end();
  await closeRateLimitRedis();
}
