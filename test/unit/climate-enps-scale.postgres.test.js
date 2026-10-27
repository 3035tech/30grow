import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

test('migration 174 fixes the reproduced eNPS failure, preserves values and can be reapplied', { skip: process.env.DTOV !== '1' }, async () => {
  const client = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only' });
  await client.connect();
  try {
    // Temporary shadow table only; no actual company, question or response is touched.
    await client.query(`CREATE TEMP TABLE climate_survey_questions (id int, question_kind text, scale_min smallint, scale_max smallint,
      CONSTRAINT climate_survey_questions_scale_chk CHECK (scale_min>=1 AND scale_max<=10 AND scale_min<scale_max))`);
    await client.query("INSERT INTO climate_survey_questions VALUES (1,'likert',1,5),(2,'text',1,5)");
    await assert.rejects(client.query("INSERT INTO climate_survey_questions VALUES (3,'enps',0,10)"), error => error.code === '23514');
    const before = (await client.query('SELECT * FROM climate_survey_questions ORDER BY id')).rows;
    const migration = await readFile(new URL('../../migrations/174_climate_enps_scale.sql', import.meta.url), 'utf8');
    await client.query(migration);
    assert.deepEqual((await client.query('SELECT * FROM climate_survey_questions ORDER BY id')).rows, before);
    await client.query("INSERT INTO climate_survey_questions VALUES (3,'enps',0,10)");
    for (const values of ["(4,'likert',0,5)", "(4,'enps',-1,10)", "(4,'enps',0,11)", "(4,'enps',0,0)"]) await assert.rejects(client.query(`INSERT INTO climate_survey_questions VALUES ${values}`), error => error.code === '23514');
    await client.query(migration);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM climate_survey_questions')).rows[0].n, 3);
  } finally { await client.end(); }
});
