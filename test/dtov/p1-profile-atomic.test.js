// Local SQL only. Execute the real PATCH and DP domain; all fixtures roll back.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import pg from 'pg';
import { rejectionReasonsSql } from '../../lib/recruiting/pipeline.js';
import { candidateTagsSelectSql } from '../../lib/recruiting/candidate-tags-core.js';
import { loadOperationalSummaries } from '../../lib/people/operational-summary.js';
import * as permissions from '../../lib/identity/permissions.js';
import { ERR, httpStatusForError } from '../../lib/api-error-codes.js';
import { normalizeCandidateProfile } from '../../lib/recruiting/candidate-profile.js';
import { titleCasePersonName } from '../../lib/person-name.js';
import { sanitizeRichTextHtml, isRichTextEmpty } from '../../lib/sanitize-html.js';
import { upsertDpProfile } from '../../lib/people/employee-dp.js';
import * as auditChanges from '../../lib/audit-changes.js';
import { EMPLOYMENT_STATUS, WORK_FORMATS } from '../../lib/domain-status.js';
import { normalizeLocale } from '../../lib/i18n.js';
import { normalizeTimeClockOverride } from '../../lib/people/time-clock-eligibility.js';

const db = new pg.Client({ host: '127.0.0.1', port: 55432, database: 'enneagram_dtov', user: 'dtov', password: 'dtov_local_only', ssl: false });
await db.connect();
try {
  await db.query('BEGIN');
  const companyId = (await db.query("INSERT INTO companies(name,slug) VALUES('Atomic profile',$1) RETURNING id", [`atomic-${crypto.randomUUID()}`])).rows[0].id;
  const id = (await db.query("INSERT INTO candidates(company_id,full_name,employment_status,work_format) VALUES($1,'Original Name','employee','clt') RETURNING id", [companyId])).rows[0].id;
  const actorId = (await db.query('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0].id;
  let payload = { userId: actorId, role: 'hr', companyId };
  let failAfterDp = false;
  const audits = [];
  const deps = {
    loadOperationalSummaries, rejectionReasonsSql, candidateTagsSelectSql,
    ...permissions, ...auditChanges, ERR, httpStatusForError, EMPLOYMENT_STATUS, WORK_FORMATS, normalizeLocale, normalizeTimeClockOverride, normalizeCandidateProfile, titleCasePersonName, sanitizeRichTextHtml, isRichTextEmpty,
    NextResponse: { json: Response.json }, COOKIE_NAME: 'session',
    cookies: async () => ({ get: () => ({ value: 'synthetic' }) }),
    verifySessionWithCapabilities: async () => payload,
    query: (...args) => db.query(...args), queryRead: (...args) => db.query(...args),
    withTransaction: async work => {
      await db.query('SAVEPOINT profile_patch');
      try { const result = await work(db); await db.query('RELEASE SAVEPOINT profile_patch'); return result; }
      catch (error) { await db.query('ROLLBACK TO SAVEPOINT profile_patch'); throw error; }
    },
    upsertDpProfile: async (client, input) => {
      const result = await upsertDpProfile(client, input);
      if (failAfterDp) throw new Error('Synthetic storage failure after DP write');
      return result;
    },
    apiError: (_req, code, status) => Response.json({ errorCode: code }, { status }), localeFromRequest: () => 'pt-BR',
    isValidEmployeeEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')),
    revokeEmployeeAccessForEmailChange: async () => null, finishEmployeeEmailChange: async () => null,
    audit: async entry => audits.push(entry), auditFromRequest: async (_req, entry) => audits.push(entry),
    buildCandidateTimeline: async () => [], buildCandidatePeopleBrief: async () => null, listCandidateOverdueLms: async () => [],
  };
  const context = vm.createContext({ Response, console: { error() {} } });
  const route = new vm.SourceTextModule(await readFile('app/api/admin/candidates/[id]/route.js', 'utf8'), { context });
  await route.link(() => new vm.SyntheticModule(Object.keys(deps), function () {
    for (const [key, value] of Object.entries(deps)) this.setExport(key, value);
  }, { context }));
  await route.evaluate();
  const patch = body => route.namespace.PATCH(new Request('http://localhost/api/admin/candidates/' + id, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
  const state = async () => ({
    candidate: (await db.query('SELECT full_name,work_format FROM candidates WHERE id=$1', [id])).rows[0],
    profile: (await db.query('SELECT emergency_name FROM candidate_dp_profiles WHERE candidate_id=$1', [id])).rows,
    history: (await db.query('SELECT previous_format,new_format FROM employee_work_format_history WHERE candidate_id=$1 ORDER BY id', [id])).rows,
  });
  const original = await state();
  const body = { fullName: 'Changed Name', workFormat: 'pj', workFormatEffectiveDate: '2026-09-26', dpProfile: { emergencyName: 'Emergency', cpf: 'invalid' } };
  assert.equal((await patch(body)).status, 400);
  assert.deepEqual(await state(), original);
  assert.equal(audits.length, 0);
  body.dpProfile.cpf = '12345678901';
  failAfterDp = true;
  assert.equal((await patch(body)).status, 500);
  assert.deepEqual(await state(), original);
  assert.equal(audits.length, 0);
  failAfterDp = false;
  payload = { ...payload, companyId: Number(companyId) + 99999 };
  assert.equal((await patch(body)).status, 401);
  payload = { userId: actorId, role: 'hr', companyId, capabilitiesCustomized: true, capabilityOverrides: [{ capability: permissions.CAP.VACANCIES_VIEW, granted: true }] };
  assert.equal((await patch(body)).status, 401);
  const recruiterEmail = await patch({ email: `moved-${crypto.randomUUID()}@example.com` });
  assert.equal(recruiterEmail.status, 403, 'recruiter-only role cannot change an employee corporate e-mail');
  assert.equal((await recruiterEmail.json()).errorCode, ERR.EMPLOYEE_EMAIL_CHANGE_FORBIDDEN);
  payload = { userId: actorId, role: 'hr', companyId };
  body.dpProfile.companyId = Number(companyId) + 99999;
  body.dpProfile.candidateId = Number(id) + 99999;
  const saved = await patch(body);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).dpProfile.emergencyName, 'Emergency');
  const after = await state();
  assert.equal(after.candidate.work_format, 'pj');
  assert.equal(after.profile[0].emergency_name, 'Emergency');
  assert.equal(after.history.length, 1);
  assert.equal(audits.find(entry => entry.action === 'dp.profile.updated').companyId, companyId);
  assert.equal((await patch(body)).status, 200);
  assert.equal((await state()).history.length, 1);
  console.log('PASS atomic candidate/DP/history, rollback after validation and write failure, retry, tenant/capability gates and authoritative IDs');
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
