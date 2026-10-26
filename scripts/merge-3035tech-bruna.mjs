/** One-off, guarded merge of Bruna Zerbin's duplicate production records. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Client } from 'pg';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const mode = process.argv[2];
if (!['--dry-run', '--apply'].includes(mode)) throw new Error('Use --dry-run or --apply');

const COMPANY_ID = 3;
const OLD_ID = 137;
const KEEP_ID = 151;
const EXPECTED_REFERENCES = new Map([
  ['candidate_notifications.recipient_candidate_id', 35],
  ['development_plans.candidate_id', 3],
  ['employee_dp_documents.candidate_id', 6],
  ['employee_login_tokens.candidate_id', 1],
  ['employee_onboarding_checkins.candidate_id', 3],
  ['employee_pre_onboarding_items.candidate_id', 4],
  ['okr_key_result_assignees.candidate_id', 2],
  ['time_clock_person_history.candidate_id', 2],
]);

function assert(value, message) {
  if (!value) throw new Error(message);
}

function quote(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

async function assertCount(db, sql, params, expected, label) {
  const result = await db.query(sql, params);
  assert(result.rowCount === expected, `${label}: expected ${expected}, got ${result.rowCount}`);
  return result.rows;
}

async function candidateReferences(db) {
  const columns = await db.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name ILIKE '%candidate%'
      AND data_type IN ('bigint', 'integer')
    ORDER BY table_name, column_name`);
  const found = new Map();
  for (const column of columns.rows) {
    const key = `${column.table_name}.${column.column_name}`;
    const result = await db.query(
      `SELECT COUNT(*)::int AS n FROM ${quote(column.table_schema)}.${quote(column.table_name)} WHERE ${quote(column.column_name)} = $1`,
      [OLD_ID]
    );
    if (result.rows[0].n) found.set(key, result.rows[0].n);
  }
  return found;
}

async function captureBackup(db) {
  const tables = [
    ['candidates', 'id'],
    ['candidate_notifications', 'recipient_candidate_id'],
    ['development_plans', 'candidate_id'],
    ['employee_dp_documents', 'candidate_id'],
    ['employee_login_tokens', 'candidate_id'],
    ['employee_onboarding_checkins', 'candidate_id'],
    ['employee_onboarding_stage_choices', 'candidate_id'],
    ['employee_pre_onboarding_items', 'candidate_id'],
    ['okr_key_result_assignees', 'candidate_id'],
    ['time_clock_person_history', 'candidate_id'],
  ];
  const rows = {};
  for (const [table, column] of tables) {
    rows[table] = (await db.query(
      `SELECT * FROM ${quote(table)} WHERE ${quote(column)} = ANY($1::bigint[])`,
      [[OLD_ID, KEEP_ID]]
    )).rows;
  }
  const filename = `/private/tmp/30grow-bruna-merge-backup-${Date.now()}.json`;
  const content = JSON.stringify({ capturedAt: new Date().toISOString(), companyId: COMPANY_ID, oldId: OLD_ID, keepId: KEEP_ID, rows });
  fs.writeFileSync(filename, content, { flag: 'wx', mode: 0o600 });
  return { filename, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const secrets = new SecretsManagerClient({ region: 'us-west-2' });
let db;
let inTransaction = false;
try {
  const secret = JSON.parse((await secrets.send(new GetSecretValueCommand({ SecretId: '/prod/30grow/database' }))).SecretString);
  const host = secret.POSTGRES_HOST || secret.host;
  const database = secret.POSTGRES_DB || secret.dbname;
  const user = secret.POSTGRES_USER || secret.username;
  const port = Number(secret.POSTGRES_PORT || secret.port || 5432);
  assert(host === 'general.c4hf2yg3qbxe.us-west-2.rds.amazonaws.com' && database === 'grow30' && port === 5432, 'Production target guard failed');
  assert(user === 'grow30_app', 'Database role guard failed');
  db = new Client({
    host, port, database, user,
    password: secret.POSTGRES_PASSWORD || secret.password,
    ssl: { ca: fs.readFileSync('/private/tmp/30grow-rds-ca.pem', 'utf8'), rejectUnauthorized: true },
    connectionTimeoutMillis: 10000,
  });
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  inTransaction = true;
  await db.query("SET LOCAL lock_timeout = '5s'");
  await db.query("SET LOCAL statement_timeout = '30s'");

  const people = await db.query('SELECT * FROM candidates WHERE company_id=$1 AND id=ANY($2::bigint[]) ORDER BY id FOR UPDATE', [COMPANY_ID, [OLD_ID, KEEP_ID]]);
  const old = people.rows.find(row => Number(row.id) === OLD_ID);
  const keep = people.rows.find(row => Number(row.id) === KEEP_ID);
  assert(old && keep, 'Both Bruna records must exist');
  assert(old.full_name === 'Bruna Zerbin' && keep.full_name === old.full_name, 'Name guard failed');
  assert(old.employment_status === 'employee' && keep.employment_status === 'employee', 'Status guard failed');
  assert(old.email === 'bruna.zerbin@gmail.com' && keep.email === 'bruna.zerbin@3035tech.com', 'Email guard failed');
  assert(keep.password_hash && !old.password_hash && Number(keep.session_version) >= 2, 'Portal access guard failed');
  assert(old.start_date?.toISOString().slice(0, 10) === '2021-05-01' && keep.start_date?.toISOString().slice(0, 10) === '2021-05-01', 'Start date guard failed');
  assert(!keep.phone && !keep.city && !keep.state && !keep.job_role_id && !keep.manager_candidate_id, 'Current record changed; review field merge');
  assert(keep.personal_email === keep.email, 'Current personal email changed; review field merge');

  const references = await candidateReferences(db);
  assert(references.size === EXPECTED_REFERENCES.size, `Unexpected reference set: ${JSON.stringify(Object.fromEntries(references))}`);
  for (const [key, count] of EXPECTED_REFERENCES) assert(references.get(key) === count, `${key}: expected ${count}, got ${references.get(key)}`);

  const duplicateNotifications = await db.query(`
    SELECT COUNT(*)::int AS n FROM candidate_notifications old
    JOIN candidate_notifications current ON current.recipient_candidate_id=$2 AND current.dedupe_key=old.dedupe_key
    WHERE old.recipient_candidate_id=$1 AND old.dedupe_key IS NOT NULL`, [OLD_ID, KEEP_ID]);
  assert(duplicateNotifications.rows[0].n === 0, 'Notification dedupe conflict');
  const duplicateOkr = await db.query(`
    SELECT COUNT(*)::int AS n FROM okr_key_result_assignees old
    JOIN okr_key_result_assignees current ON current.candidate_id=$2 AND current.key_result_id=old.key_result_id
    WHERE old.candidate_id=$1`, [OLD_ID, KEEP_ID]);
  assert(duplicateOkr.rows[0].n === 0, 'OKR assignment conflict');

  const docs = await db.query('SELECT candidate_id,doc_key,status,notes,file_key,file_url,file_name,signature_status,signature_file_key,signer_stroke_png,signed_at FROM employee_dp_documents WHERE candidate_id=ANY($1::bigint[])', [[OLD_ID, KEEP_ID]]);
  assert(docs.rowCount === 12 && docs.rows.every(row => row.status === 'pending' && !row.notes?.trim() && !row.file_key && !row.file_url && !row.file_name && row.signature_status === 'none' && !row.signature_file_key && !row.signer_stroke_png && !row.signed_at), 'Document rows are no longer empty placeholders');
  assert(new Set(docs.rows.map(row => row.doc_key)).size === 6, 'Document keys differ');
  const checkins = await db.query('SELECT candidate_id,milestone_days,status,notes,meet_url,employee_ack_at FROM employee_onboarding_checkins WHERE candidate_id=ANY($1::bigint[])', [[OLD_ID, KEEP_ID]]);
  assert(checkins.rowCount === 6 && checkins.rows.every(row => row.status === 'skipped' && !row.notes?.trim() && !row.meet_url && !row.employee_ack_at), 'Check-in rows changed');
  assert(new Set(checkins.rows.map(row => row.milestone_days)).size === 3, 'Check-in milestones differ');
  const pre = await db.query('SELECT candidate_id,item_key,status,notes,meet_url FROM employee_pre_onboarding_items WHERE candidate_id=ANY($1::bigint[])', [[OLD_ID, KEEP_ID]]);
  assert(pre.rowCount === 8 && pre.rows.every(row => !row.notes?.trim() && !row.meet_url), 'Pre-onboarding rows changed');
  assert(new Set(pre.rows.map(row => row.item_key)).size === 4, 'Pre-onboarding keys differ');
  assert(pre.rows.filter(row => Number(row.candidate_id) === OLD_ID).every(row => row.status === 'done'), 'Old pre-onboarding status changed');
  assert(pre.rows.filter(row => Number(row.candidate_id) === KEEP_ID).every(row => row.status === 'skipped'), 'Current pre-onboarding status changed');
  const clock = await db.query('SELECT candidate_id,effective_on::text AS effective_on FROM time_clock_person_history WHERE candidate_id=ANY($1::bigint[]) ORDER BY candidate_id,effective_on', [[OLD_ID, KEEP_ID]]);
  assert(clock.rowCount === 3 && clock.rows.filter(row => Number(row.candidate_id) === OLD_ID).map(row => row.effective_on).join(',') === '0001-01-01,2026-10-22' && clock.rows.find(row => Number(row.candidate_id) === KEEP_ID)?.effective_on === '0001-01-01', 'Time-clock history changed');
  const staleToken = await db.query('SELECT expires_at,used_at FROM employee_login_tokens WHERE candidate_id=$1', [OLD_ID]);
  assert(staleToken.rowCount === 1 && staleToken.rows[0].expires_at < new Date(), 'Old login token is active or changed');
  const oldAssessment = await db.query('SELECT COUNT(*)::int AS n FROM assessments WHERE candidate_id=$1', [OLD_ID]);
  assert(oldAssessment.rows[0].n === 0, 'Old record acquired an assessment');

  const backup = mode === '--apply' ? await captureBackup(db) : null;
  const changes = {};
  changes.person = (await db.query(`
    UPDATE candidates SET personal_email=$2,phone=$3,city=$4,state=$5,
      job_role_id=$6,manager_candidate_id=$7,hired_at=$8
    WHERE id=$1 AND company_id=$9 RETURNING id`,
    [KEEP_ID, old.email, old.phone, old.city, old.state, old.job_role_id, old.manager_candidate_id, old.hired_at, COMPANY_ID])).rowCount;
  changes.notifications = (await db.query('UPDATE candidate_notifications SET recipient_candidate_id=$2 WHERE recipient_candidate_id=$1 RETURNING id', [OLD_ID, KEEP_ID])).rowCount;
  changes.plans = (await db.query('UPDATE development_plans SET candidate_id=$2 WHERE candidate_id=$1 AND company_id=$3 RETURNING id', [OLD_ID, KEEP_ID, COMPANY_ID])).rowCount;
  changes.okr = (await db.query('UPDATE okr_key_result_assignees SET candidate_id=$2 WHERE candidate_id=$1 AND company_id=$3 RETURNING key_result_id', [OLD_ID, KEEP_ID, COMPANY_ID])).rowCount;
  changes.loginTokens = (await db.query('UPDATE employee_login_tokens SET candidate_id=$2 WHERE candidate_id=$1 AND company_id=$3 RETURNING id', [OLD_ID, KEEP_ID, COMPANY_ID])).rowCount;
  changes.preOnboardingPromoted = (await db.query(`
    UPDATE employee_pre_onboarding_items current
    SET status=old.status,completed_at=old.completed_at,completed_by_user_id=old.completed_by_user_id,
      updated_at=GREATEST(current.updated_at,old.updated_at)
    FROM employee_pre_onboarding_items old
    WHERE current.candidate_id=$2 AND old.candidate_id=$1 AND current.company_id=$3
      AND old.company_id=$3 AND current.item_key=old.item_key RETURNING current.id`, [OLD_ID, KEEP_ID, COMPANY_ID])).rowCount;
  changes.oldPreOnboardingRemoved = (await db.query('DELETE FROM employee_pre_onboarding_items WHERE candidate_id=$1 AND company_id=$2 RETURNING id', [OLD_ID, COMPANY_ID])).rowCount;
  changes.emptyDocumentsRemoved = (await db.query('DELETE FROM employee_dp_documents WHERE candidate_id=$1 AND company_id=$2 RETURNING id', [OLD_ID, COMPANY_ID])).rowCount;
  changes.duplicateCheckinsRemoved = (await db.query('DELETE FROM employee_onboarding_checkins WHERE candidate_id=$1 AND company_id=$2 RETURNING id', [OLD_ID, COMPANY_ID])).rowCount;
  changes.duplicateClockBaseRemoved = (await db.query("DELETE FROM time_clock_person_history WHERE candidate_id=$1 AND company_id=$2 AND effective_on=DATE '0001-01-01' RETURNING id", [OLD_ID, COMPANY_ID])).rowCount;
  changes.clockHistoryMoved = (await db.query('UPDATE time_clock_person_history SET candidate_id=$2 WHERE candidate_id=$1 AND company_id=$3 RETURNING id', [OLD_ID, KEEP_ID, COMPANY_ID])).rowCount;
  for (const [key, expected] of Object.entries({ person: 1, notifications: 35, plans: 3, okr: 2, loginTokens: 1, preOnboardingPromoted: 4, oldPreOnboardingRemoved: 4, emptyDocumentsRemoved: 6, duplicateCheckinsRemoved: 3, duplicateClockBaseRemoved: 1, clockHistoryMoved: 1 })) {
    assert(changes[key] === expected, `${key}: expected ${expected}, got ${changes[key]}`);
  }
  assert((await candidateReferences(db)).size === 0, 'Old record still has references');
  changes.oldPersonRemoved = (await db.query('DELETE FROM candidates WHERE id=$1 AND company_id=$2 RETURNING id', [OLD_ID, COMPANY_ID])).rowCount;
  assert(changes.oldPersonRemoved === 1, 'Old record was not deleted');
  const proof = await db.query(`
    SELECT c.id,c.full_name,c.email,c.personal_email,c.employment_status,
      c.password_hash IS NOT NULL AS has_login,c.job_role_id,c.manager_candidate_id,
      (SELECT COUNT(*)::int FROM development_plans p WHERE p.candidate_id=c.id) AS plans,
      (SELECT COUNT(*)::int FROM candidate_notifications n WHERE n.recipient_candidate_id=c.id) AS notifications,
      (SELECT COUNT(*)::int FROM ae_attempts a WHERE a.candidate_id=c.id AND a.status='completed') AS completed_motivators
    FROM candidates c WHERE c.company_id=$1 AND c.id=$2`, [COMPANY_ID, KEEP_ID]);
  assert(proof.rowCount === 1 && proof.rows[0].plans === 3 && proof.rows[0].notifications === 36 && proof.rows[0].completed_motivators === 1 && proof.rows[0].has_login, 'Post-merge proof failed');
  assert((await db.query('SELECT COUNT(*)::int AS n FROM candidates WHERE company_id=$1 AND lower(full_name)=$2', [COMPANY_ID, 'bruna zerbin'])).rows[0].n === 1, 'Duplicate remains');

  if (mode === '--dry-run') await db.query('ROLLBACK');
  else await db.query('COMMIT');
  inTransaction = false;
  console.log(JSON.stringify({ mode, outcome: mode === '--dry-run' ? 'rolled_back' : 'committed', changes, kept: proof.rows[0], backup }, null, 2));
} catch (error) {
  if (inTransaction) await db?.query('ROLLBACK').catch(() => {});
  console.error(error.code || error.name, error.message);
  process.exitCode = 1;
} finally {
  await db?.end().catch(() => {});
  secrets.destroy();
}
