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
  second_factor_challenges: ['id', 'purpose', 'user_id', 'candidate_id', 'company_id', 'session_version', 'expires_at'],
  companies: ['id', 'enabled_modules', 'deleted'],
  users: ['id', 'company_id', 'role', 'active', 'deleted'],
  candidates: ['id', 'company_id', 'email', 'employment_status'],
  vacancies: ['id', 'company_id', 'status', 'public_page_enabled', 'pipeline_template_id'],
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

