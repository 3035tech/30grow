import pg from 'pg';
import { getPgBaseConfig } from '../lib/pg-config.js';
import { validateRuntimeSchema } from '../lib/runtime-schema.js';
const db = new pg.Client({ ...getPgBaseConfig(), connectionTimeoutMillis: 10000, statement_timeout: 10000 });
try {
  await db.connect();
  await validateRuntimeSchema(db);
  console.log('Runtime security/billing schema verified');
} catch (error) {
  console.error('Runtime schema verification failed; server will not start. Apply migrations and verify runtime grants.', { code: error.code || error.name });
  process.exitCode = 1;
} finally {
  await db.end();
}
