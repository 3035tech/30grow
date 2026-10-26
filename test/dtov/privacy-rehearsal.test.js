// Privacy rehearsal using real route handlers and SQL in local DTOV; all fixtures roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import pg from 'pg';
import * as permissions from '../../lib/identity/permissions.js';
import { ERR } from '../../lib/api-error-codes.js';
import { normalizeCandidateProfile } from '../../lib/recruiting/candidate-profile.js';
import { titleCasePersonName } from '../../lib/person-name.js';
import { sanitizeRichTextHtml, isRichTextEmpty } from '../../lib/sanitize-html.js';


const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
try {
  await db.query('BEGIN');
  const companyId = (await db.query("INSERT INTO companies(name,slug) VALUES('Atomic profile',$1) RETURNING id", [`atomic-${crypto.randomUUID()}`])).rows[0].id;
  const id = (await db.query("INSERT INTO candidates(company_id,full_name,employment_status,work_format) VALUES($1,'Original Name','employee','clt') RETURNING id", [companyId])).rows[0].id;
  const actorId = (await db.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0].id;
  let payload = { userId: actorId, role: 'hr', companyId };

  const audits = [];
  const deps = {
    ...permissions, ERR, normalizeCandidateProfile, titleCasePersonName, sanitizeRichTextHtml, isRichTextEmpty,
    NextResponse: { json: Response.json }, COOKIE_NAME: 'session',
    cookies: async () => ({ get: () => ({ value: 'synthetic' }) }),
    verifySessionWithCapabilities: async () => payload,
    query: (...args) => db.query(...args), queryRead: (...args) => db.query(...args),
    withTransaction: async work => {
      await db.query('SAVEPOINT profile_patch');
      try { const result = await work(db); await db.query('RELEASE SAVEPOINT profile_patch'); return result; }
      catch (error) { await db.query('ROLLBACK TO SAVEPOINT profile_patch'); throw error; }
    },
    upsertDpProfile: async () => { throw new Error('DP outside rehearsal scope'); },
    apiError: (_req, code, status) => Response.json({ errorCode: code }, { status }),
    audit: async entry => audits.push(entry), auditFromRequest: async (_req, entry) => audits.push(entry),
    buildCandidateTimeline: async () => [], buildCandidatePeopleBrief: async () => null, listCandidateOverdueLms: async () => [],
  };
  const context = vm.createContext({ URL, Response, console: { error() {} } });
  const route = new vm.SourceTextModule(await readFile('app/api/admin/candidates/[id]/route.js', 'utf8'), { context });
  await route.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
  }, { context }));
  await route.evaluate();
  const patch = body => route.namespace.PATCH(new Request('http://localhost/api/admin/candidates/' + id, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
  const props = { params: Promise.resolve({ id: String(id) }) };
  const req = new Request('http://localhost/api/admin/candidates/' + id);
  const read = await route.namespace.GET(req, props);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).candidate.fullName, 'Original Name');
  assert.equal((await patch({ fullName: 'Corrected Person' })).status, 200);
  assert.equal((await (await route.namespace.GET(req, props)).json()).candidate.fullName, 'Corrected Person');
  const otherCompany = (await db.query("INSERT INTO companies(name,slug) VALUES('Privacy other',$1) RETURNING id", [`privacy-${crypto.randomUUID()}`])).rows[0].id;
  const otherId = (await db.query("INSERT INTO candidates(company_id,full_name) VALUES($1,'Corrected Person') RETURNING id", [otherCompany])).rows[0].id;
  const legacy = (await db.query("INSERT INTO results(name,top_type,scores) VALUES('Corrected Person',1,'{}') RETURNING id")).rows[0].id;
  payload = { ...payload, companyId: otherCompany };
  assert.equal((await route.namespace.GET(req, props)).status, 401);
  assert.equal((await patch({ fullName: 'Forbidden' })).status, 401);
  assert.equal((await route.namespace.DELETE(req, props)).status, 401);
  payload = { ...payload, companyId };
  assert.equal((await route.namespace.DELETE(req, props)).status, 200);
  assert.equal((await db.query('SELECT id FROM candidates WHERE id=$1', [id])).rowCount, 0);
  assert.equal((await db.query('SELECT id FROM candidates WHERE id=$1', [otherId])).rowCount, 1);
  assert.equal((await db.query('SELECT id FROM results WHERE id=$1', [legacy])).rowCount, 1);
  assert.equal(audits.find(e => e.action === 'candidate.delete').companyId, companyId);

  const retentionContext = vm.createContext({ process });
  const retention = new vm.SourceTextModule(await readFile('lib/retention.js', 'utf8'), { context: retentionContext });
  await retention.link(() => new vm.SyntheticModule(['query'], function () { this.setExport('query', (...args) => db.query(...args)); }, { context: retentionContext }));
  await retention.evaluate();
  const purge = retention.namespace.purgeExpiredAssessmentsAndOrphans;
  await assert.rejects(() => purge({ days: 30 }), /INVALID_COMPANY_ID/);
  const ownId = (await db.query("INSERT INTO candidates(company_id,full_name) VALUES($1,'Retention Person') RETURNING id", [companyId])).rows[0].id;
  const areaId = (await db.query('SELECT id FROM areas LIMIT 1')).rows[0].id;
  for (const [cid, coid] of [[ownId,companyId],[otherId,otherCompany]]) {
    await db.query("INSERT INTO assessments(candidate_id,company_id,area_id,top_type,scores,created_at) VALUES($1,$2,$3,1,'{}',NOW()-INTERVAL '90 days')", [cid,coid,areaId]);
  }
  const preview = await purge({ days:30, companyId });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.eligibleAssessments, 1);
  assert.equal((await db.query('SELECT id FROM assessments WHERE candidate_id=$1', [ownId])).rowCount, 1);
  const deleted = await purge({ days:30, companyId, dryRun:false });
  assert.equal(deleted.deletedAssessments, 1);
  assert.equal(deleted.deletedCandidates, 0);
  assert.equal((await db.query('SELECT id FROM candidates WHERE id=$1', [ownId])).rowCount, 1);
  assert.equal((await db.query('SELECT id FROM assessments WHERE candidate_id=$1', [otherId])).rowCount, 1);
  const retentionDeps = { ...deps, purgeExpiredAssessmentsAndOrphans: purge };
  const retentionRoute = new vm.SourceTextModule(await readFile('app/api/admin/retention/purge/route.js', 'utf8'), { context });
  await retentionRoute.link(() => new vm.SyntheticModule(Object.keys(retentionDeps), function () {
    for (const [key, value] of Object.entries(retentionDeps)) this.setExport(key, value);
  }, { context }));
  await retentionRoute.evaluate();
  const post = body => retentionRoute.namespace.POST(new Request('http://localhost/api/admin/retention/purge', { method:'POST', body:JSON.stringify(body) }));
  assert.equal((await post({ days:30, companyId })).status, 401);
  payload = { userId: actorId, role:'admin' };
  assert.equal((await post({ days:30 })).status, 400);
  assert.equal((await post({ days:'30oops', companyId })).status, 400);
  const routePreview = await post({ days:30, companyId:otherCompany });
  assert.equal(routePreview.status, 200);
  assert.equal((await routePreview.json()).dryRun, true);
  assert.equal((await db.query('SELECT id FROM assessments WHERE candidate_id=$1', [otherId])).rowCount, 1);
  console.log('PASS privacy: access/correction/deletion, cross-tenant denial, homonym preservation, audit tenant, retention preview and isolated purge; all fixtures rolled back');

} finally {
  await db.query('ROLLBACK');
  await db.end();
}
