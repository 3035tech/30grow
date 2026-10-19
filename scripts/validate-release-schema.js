/**
 * Gate somente leitura para release: prova que todas as migrations canônicas
 * foram registradas e que o contrato mínimo dos fluxos principais existe.
 *
 * Uso:
 *   npm run db:validate-schema
 *   npm run db:validate-schema:static
 */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getPgBaseConfig } from '../lib/pg-config.js';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'migrations');
const pendingBundlePath = path.join(root, 'scripts', 'scripts-banco-pendentes.sql');

const REQUIRED_SCHEMA = Object.freeze({
  company_billing_terms: ['company_id', 'managed', 'trial_ends_at'],
  company_billing_accounts: ['company_id', 'livemode', 'customer_id', 'subscription_id', 'status', 'plan_key', 'checkout_attempt'],
  billing_launch_redemptions: ['company_id', 'livemode', 'slot', 'redeemed', 'subscription_id'],
  billing_webhook_events: ['event_id', 'livemode', 'event_type', 'processed_at'],
  time_clock_person_history:['company_id','candidate_id','effective_on','start_date'],
  time_clock_company_history:['company_id','effective_on','hour_bank_enabled','hour_bank_max_minutes'],
  time_clock_unit_history:['company_id','unit_id','parent_id','effective_on'],
  time_clock_push_deliveries:['notification_id','token_id','status','attempts','total_attempts'],
  time_clock_push_attempts:['delivery_id','attempt_no','outcome','finished_at'],
  time_clock_health_observations:['kind','offset_ms','observed_at'],
  employee_time_schedules:['shift_pattern','cycle_anchor','night_rule'],
  time_clock_closure_people:['night_minutes','night_equivalent_minutes','calculation_version'],
  rep_establishments: ['id', 'company_id', 'employer_document', 'last_nsr', 'last_punch_hash'],
  rep_workers: ['id', 'company_id', 'candidate_id', 'cpf', 'weekly_rest_day'],
  rep_original_records: ['establishment_id', 'nsr', 'record_text', 'record_hash', 'punch_id'],
  rep_signed_documents: ['establishment_id', 'nsr', 'pdf', 'sha256'],
  second_factor_challenges: ['id', 'purpose', 'user_id', 'candidate_id', 'company_id', 'session_version', 'expires_at'],
  companies: ['id', 'enabled_modules', 'deleted'],
  users: ['id', 'company_id', 'role', 'active', 'deleted'],
  candidates: ['id', 'company_id', 'email', 'employment_status', 'professional_summary', 'professional_summary_updated_at'],
  org_units: ['id','company_id','parent_id','unit_type','active'],
  org_positions: ['id','company_id','org_unit_id','job_role_id','status','fte','version','approved_at'],
  org_position_assignments: ['id','company_id','position_id','candidate_id','started_on','ended_on'],
  org_position_recruitments: ['id','company_id','position_id','vacancy_id','filled_assignment_id','ended_at'],
  candidate_tags: ['id', 'company_id', 'name', 'normalized_name', 'color', 'active'],
  candidate_tag_assignments: ['company_id', 'candidate_id', 'tag_id', 'assigned_by_user_id', 'assigned_at'],
  vacancies: ['id', 'company_id', 'status', 'public_page_enabled', 'pipeline_template_id', 'headcount_managed'],
  assessments: ['id', 'candidate_id', 'company_id', 'pipeline_stage'],
  company_pipeline_stages: ['id', 'company_id', 'canonical_key', 'sort_order'],
  vacancy_pipeline_stages: ['id', 'vacancy_id', 'company_id', 'canonical_key', 'sort_order'],
  pipeline_templates: ['id', 'company_id', 'name', 'is_default'],
  lms_courses: ['id', 'company_id', 'title', 'description'],
  lms_lessons: ['id', 'course_id', 'title', 'description', 'content_url'],
  mobile_refresh_sessions: ['id', 'family_id', 'user_id', 'membership_id', 'token_hash', 'expires_at', 'revoked_at'],
});

async function canonicalMigrationNames() {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No canonical migrations found.');
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`Duplicate migration filenames: ${duplicates.join(', ')}`);
  return names;
}

async function validateStaticArtifacts(names) {
  const bundle = await readFile(pendingBundlePath, 'utf8');
  const latest = names.at(-1);
  if (!bundle.includes(`'${latest}'`)) {
    throw new Error(`PgAdmin bundle does not register latest migration: ${latest}`);
  }
  process.stdout.write(`Static schema artifacts OK · migrations=${names.length} · latest=${latest}\n`);
}

async function validateDatabase(names) {
  const client = new Client(getPgBaseConfig());
  await client.connect();
  try {
    const appliedResult = await client.query('SELECT name FROM schema_migrations ORDER BY name');
    const applied = new Set(appliedResult.rows.map((row) => row.name));
    const missingMigrations = names.filter((name) => !applied.has(name));
    if (missingMigrations.length) {
      throw new Error(`Pending migrations: ${missingMigrations.join(', ')}`);
    }

    const entries = Object.entries(REQUIRED_SCHEMA);
    const tables = entries.map(([table]) => table);
    const columnsResult = await client.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [tables]
    );
    const actual = new Map();
    for (const row of columnsResult.rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
      actual.get(row.table_name).add(row.column_name);
    }

    const missingSchema = [];
    for (const [table, columns] of entries) {
      const present = actual.get(table);
      if (!present) {
        missingSchema.push(`table ${table}`);
        continue;
      }
      for (const column of columns) {
        if (!present.has(column)) missingSchema.push(`column ${table}.${column}`);
      }
    }
    if (missingSchema.length) {
      throw new Error(`Required schema missing: ${missingSchema.join(', ')}`);
    }

    process.stdout.write(
      `Database schema OK · migrations=${names.length} · contracts=${entries.length}\n`
    );
  } finally {
    await client.end();
  }
}

async function main() {
  const names = await canonicalMigrationNames();
  await validateStaticArtifacts(names);
  if (process.argv.includes('--static')) return;
  await validateDatabase(names);
}

main().catch((error) => {
  console.error(`Schema validation failed: ${error?.message || error}`);
  process.exitCode = 1;
});

