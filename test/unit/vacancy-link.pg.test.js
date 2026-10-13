import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { Pool } from 'pg';

// Explicit opt-in: this test creates only its own temporary schema.
const databaseUrl = process.env.VACANCY_LINK_TEST_DATABASE_URL;

test('vacancy links renew expired tokens and serialize concurrent invitations', { skip: !databaseUrl }, async () => {
  const schema = `invite_regression_${crypto.randomBytes(8).toString('hex')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let db;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    await db.query(`CREATE TABLE vacancy_links (
      id bigserial PRIMARY KEY, vacancy_id bigint NOT NULL, token text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT TRUE, expires_at timestamptz NOT NULL,
      require_candidate_email boolean NOT NULL DEFAULT FALSE
    )`);
    await db.query('CREATE UNIQUE INDEX idx_vacancy_links_vacancy_active_unique ON vacancy_links (vacancy_id) WHERE active = TRUE');
    const context = vm.createContext({});
    const module = new vm.SourceTextModule(await readFile(new URL('../../lib/vacancy-link.js', import.meta.url), 'utf8'), { context });
    await module.link(specifier => {
      const values = specifier === 'node:crypto' ? { default: crypto } : {
        query: (sql, args) => db.query(sql, args),
        queryRead: (sql, args) => db.query(sql, args),
      };
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    });
    await module.evaluate();
    const ensure = module.namespace.ensureActiveVacancyLinkToken;
    await db.query("INSERT INTO vacancy_links (vacancy_id, token, expires_at, require_candidate_email) VALUES (1, 'existing-invite-token', NOW() - INTERVAL '1 day', TRUE)");
    assert.equal(await ensure(1), 'existing-invite-token');
    const renewed = (await db.query('SELECT * FROM vacancy_links WHERE vacancy_id = 1')).rows;
    assert.equal(renewed.length, 1);
    assert.equal(renewed[0].require_candidate_email, true);
    assert.ok(renewed[0].expires_at > new Date());
    assert.equal(await ensure(1), 'existing-invite-token');
    await db.query("UPDATE vacancy_links SET expires_at = NOW() + INTERVAL '90 days' WHERE vacancy_id = 1");
    const longExpiry = (await db.query('SELECT expires_at FROM vacancy_links WHERE vacancy_id = 1')).rows[0].expires_at;
    await ensure(1);
    assert.equal((await db.query('SELECT expires_at FROM vacancy_links WHERE vacancy_id = 1')).rows[0].expires_at.getTime(), longExpiry.getTime());
    const tokens = await Promise.all(Array.from({ length: 8 }, () => ensure(2)));
    assert.equal(new Set(tokens).size, 1);
    assert.equal((await db.query('SELECT * FROM vacancy_links WHERE vacancy_id = 2 AND active')).rowCount, 1);
    await db.query("INSERT INTO vacancy_links (vacancy_id, token, active, expires_at) VALUES (3, 'revoked-token', FALSE, NOW() + INTERVAL '90 days')");
    assert.notEqual(await ensure(3), 'revoked-token');
    assert.equal((await db.query("SELECT active FROM vacancy_links WHERE token = 'revoked-token'")).rows[0].active, false);
  } finally {
    if (db) await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
