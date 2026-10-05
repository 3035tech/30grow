import assert from 'node:assert/strict';
import * as auditChanges from '../../lib/audit-changes.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { z } from 'zod';
import * as domainStatus from '../../lib/domain-status.js';
import * as fileMagic from '../../lib/file-magic.js';
import * as dpUpload from '../../lib/dp-upload-validation.js';
import * as boundedMultipart from '../../lib/bounded-multipart.js';
import * as notificationCatalog from '../../lib/employee-notification-catalog.js';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
import { normalizeDependentRelation, normalizeEmergencyRelation } from '../../lib/kinship-relation.js';

async function moduleAt(path, dependencies, globals = {}) {
  const context = vm.createContext({ URL, Buffer, Response, Request, console, queueMicrotask, setTimeout, clearTimeout, AbortController, ...globals });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
  await module.evaluate(); return module.namespace;
}
const common = {
  z, ERR, HTTP_STATUS,
  NextResponse: class extends Response { static json(body, options) { return { body, ...options }; } },
  apiError: (_request, code, status) => ({ code, status }),
  apiErrorFromResult: (_request, result) => ({ code: result.errorCode, status: 404 }),
  mobileEmployeeBearerToken: () => 'test', checkRateLimit: async () => ({ ok: true }),
};
test('colleague search: strict input, bounded page, no email and authenticated tenant A/B only', async () => {
  for (const companyId of [1, 2]) {
    const calls = [];
    const deps = { ...common, authenticateMobileEmployee: async () => ({ companyId, candidateId: companyId * 10 }), searchEmployeeColleagues: async (_db, options) => { calls.push(options); return { ok: true, people: Array.from({ length: 21 }, (_, i) => ({ id: i + 1, fullName: 'Example', email: 'private@example.test' })) }; } };
    const route = await moduleAt('../../app/api/mobile/v1/employee/colleagues/route.js', deps);
    const response = await route.GET({ url: 'https://example.test/colleagues?q=Ana&page=3' });
    assert.equal(response.body.people.length, 20); assert.equal(response.body.hasMore, true);
    assert.equal(response.body.people[0].email, undefined); assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(calls[0].companyId, companyId); assert.equal(calls[0].excludeCandidateId, companyId * 10); assert.equal(calls[0].offset, 40); assert.equal(calls[0].limit, 21);
    for (const query of ['companyId=9', 'page=0', 'page=10001', 'page=1&page=2', `q=${'a'.repeat(81)}`]) assert.equal((await route.GET({ url: `https://example.test/colleagues?${query}` })).status, 400);
    assert.equal(calls.length, 1);
    deps.authenticateMobileEmployee = async () => null;
    assert.equal((await (await moduleAt('../../app/api/mobile/v1/employee/colleagues/route.js', deps)).GET({})).status, 401);
    deps.authenticateMobileEmployee = async () => ({ companyId, candidateId: 10 }); deps.checkRateLimit = async () => ({ ok: false });
    assert.equal((await (await moduleAt('../../app/api/mobile/v1/employee/colleagues/route.js', deps)).GET({ url: 'https://example.test/colleagues' })).status, 429);
  }
});
test('shared colleague query retains web defaults and applies parameterized stable offset/search', async () => {
  const calls = [];
  const domain = await moduleAt('../../lib/company-kudos.js', { asDb: (db) => db, query: null, ERR, ...domainStatus });
  const db = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  await domain.searchEmployeeColleagues(db, { companyId: 2, excludeCandidateId: 20 });
  assert.deepEqual([...calls[0].values], [2, 20, 20, 0]);
  await domain.searchEmployeeColleagues(db, { companyId: 2, excludeCandidateId: 20, q: 'A%_', limit: 21, offset: 40 });
  assert.deepEqual([...calls[1].values], [2, 20, '%A%', 21, 40]);
  assert.match(calls[1].sql, /c.company_id = \$1/); assert.match(calls[1].sql, /c.id <> \$2/);
  assert.match(calls[1].sql, /ORDER BY c.full_name ASC, c.id ASC/);
});

const uploadPath = '../../app/api/mobile/v1/employee/dp/leave/[id]/file/route.js';
function uploadRequest({ size = 100, extra = false } = {}) {
  const body = new FormData(); body.append('file', new Blob([new Uint8Array(size)], { type: 'application/pdf' }), 'proof.pdf');
  if (extra) body.append('companyId', '99');
  return new Request('https://example.test/file', { method: 'POST', body });
}
test('attachment route: bearer, owned row lock before storage, no cross-tenant writes and bounded multipart', async () => {
  for (const companyId of [1, 2]) {
    const calls = []; let own = true; let uploads = 0;
    const session = { companyId, candidateId: companyId * 10 };
    const deps = { ...common, ...boundedMultipart, DP_DOC_MAX_BYTES: 5 * 1024 * 1024, authenticateMobileEmployee: async () => session, query: async () => ({}),
      withTransaction: async (fn) => fn({ query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: own ? 1 : 0 }; } }),
      uploadLeaveAttachment: async (_db, input) => { uploads++; assert.equal(input.companyId, companyId); assert.equal(input.candidateId, companyId * 10); assert.equal(input.id, 22); return { ok: true }; },
      downloadLeaveAttachment: async (_db, input) => { assert.equal(input.companyId, companyId); return { ok: true, body: Buffer.from('pdf'), fileName: 'a\r\n.pdf', contentType: 'application/pdf' }; },
      getEmployeeDpHome: async () => ({ ok: true, leaves: [] }), getEmployeeDisplayName: async () => '', notifyCompanyManagers: async () => {}, NOTIF: { DP_LEAVE_FILE: 'file' },
    };
    const route = await moduleAt(uploadPath, deps), props = { params: Promise.resolve({ id: '22' }) };
    const response = await route.POST(uploadRequest(), props);
    assert.equal(response.body.ok, true); assert.equal(uploads, 1);
    assert.deepEqual([...calls[0].values], [22, companyId, companyId * 10]); assert.match(calls[0].sql, /FOR UPDATE/);
    own = false;
    assert.equal((await route.POST(uploadRequest(), props)).code, ERR.NOT_FOUND); assert.equal(uploads, 1);
    assert.equal((await route.POST(uploadRequest({ extra: true }), props)).status, 400);
    const oversized = new Request('https://example.test/file', { method: 'POST', body: new Uint8Array(6 * 1024 * 1024), headers: { 'Content-Type': 'multipart/form-data; boundary=test' } });
    assert.equal((await route.POST(oversized, props)).code, ERR.INVALID_CV_FILE_SIZE);
    assert.equal((await route.POST(uploadRequest(), { params: Promise.resolve({ id: '../22' }) })).status, 400);
    const opened = await route.GET({}, props);
    assert.equal(opened.headers.get('cache-control'), 'private, no-store'); assert.equal(opened.headers.get('content-disposition'), 'attachment; filename="a__.pdf"');
    deps.authenticateMobileEmployee = async () => null;
    const anonymous = await moduleAt(uploadPath, deps);
    assert.equal((await anonymous.POST(uploadRequest(), props)).status, 401); assert.equal((await anonymous.GET({}, props)).status, 401);
  }
});
test('attachment domain checks employee/company/leave and storage prefix; upload reuses sick/status/magic guards', async () => {
  let downloads = 0, puts = 0;
  const deps = { ...domainStatus, ...fileMagic, ...dpUpload, ...auditChanges, ERR, default: crypto, asDb: (db) => db, companyScopedObjectKey: (id, path) => `companies/${id}/${path}`, getObjectBytes: async () => { downloads++; return { body: Buffer.from('pdf'), contentType: 'application/pdf' }; }, putObject: async () => { puts++; return { url: 'private' }; }, deleteObjectBestEffort: async () => {}, isObjectStorageConfigured: () => true, leaveInclusiveDays: () => 1, expandLeaveCalendarByDay: () => [], sanitizeRichTextHtml: (text) => text, stripCep: (v) => v, stripCpf: (v) => v, stripPhone: (v) => v, normalizeDependentRelation, normalizeEmergencyRelation, DB_FANOUT_CONCURRENCY: 4, DP_ADDRESS_NUMBER_MAX_LENGTH: 20 };
  const domain = await moduleAt('../../lib/people/employee-dp.js', deps);
  for (const companyId of [1, 2]) {
    const candidateId = companyId * 10, id = 22, calls = [];
    let fileKey = `companies/${companyId}/dp-leave/${candidateId}/${id}/opaque.pdf`;
    const db = { query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1, rows: sql.includes('FROM candidates') ? [{ employmentStatus: 'employee' }] : [{ fileKey, fileName: 'proof.pdf' }] }; } };
    assert.equal((await domain.downloadLeaveAttachment(db, { id, companyId, candidateId })).ok, true);
    assert.deepEqual([...calls[1].values], [id, companyId, candidateId]); assert.match(calls[1].sql, /company_id = \$2 AND candidate_id = \$3/);
    for (const otherKey of [`companies/99/dp-leave/${candidateId}/${id}/opaque.pdf`, `companies/${companyId}/dp-leave/99/${id}/opaque.pdf`, `companies/${companyId}/dp-leave/${candidateId}/99/opaque.pdf`]) {
      fileKey = otherKey; assert.equal((await domain.downloadLeaveAttachment(db, { id, companyId, candidateId })).errorCode, ERR.NOT_FOUND);
    }
    const uploadDb = (row) => ({ query: async () => ({ rowCount: 1, rows: [row] }) });
    for (const row of [{ candidateId: 99, leaveType: 'sick', status: 'requested' }, { candidateId, leaveType: 'vacation', status: 'requested' }, { candidateId, leaveType: 'sick', status: 'rejected' }, { candidateId, leaveType: 'sick', status: 'cancelled' }]) assert.equal((await domain.uploadLeaveAttachment(uploadDb(row), { id, companyId, candidateId })).ok, false);
    await assert.rejects(domain.uploadLeaveAttachment(uploadDb({ candidateId, leaveType: 'sick', status: 'requested' }), { id, companyId, candidateId, file: { buffer: Buffer.from('not a PDF'), size: 9, mimeType: 'application/pdf' } }));
  }
  assert.equal(downloads, 2); assert.equal(puts, 0);
});
test('native push keeps legacy destination but sends only generic copy and an opaque reference', async () => {
  let sent;
  const domain = await moduleAt('../../lib/mobile-employee-push.js', { asDb: (db) => db, query: null, ...notificationCatalog }, { fetch: async (_url, options) => { sent = JSON.parse(options.body); return { ok: true }; } });
  const db = { query: async (sql, values) => { assert.match(sql, /candidate_id = \$1 AND company_id = \$2/); assert.deepEqual([...values], [10, 1]); return { rows: [{ token: 'ExpoPushToken[test]' }] }; } };
  await domain.sendMobileEmployeePush(db, { candidateId: 10, companyId: 1, destination: 'dp', notificationId: 99, title: 'Sensitive', body: 'Health details' });
  assert.equal(sent[0].data.notificationId, '99'); assert.equal(sent[0].data.url, 'team30://workspace?destination=dp');
  assert.equal(sent[0].title, '30 Grow'); assert.equal(JSON.stringify(sent).includes('Health details'), false); assert.equal(JSON.stringify(sent).includes('Sensitive'), false);
});
test('notification reference lookup binds both tenant and recipient; fanout emits only inserted recipient/ID pairs', async () => {
  const sends = [], calls = [];
  const domain = await moduleAt('../../lib/employee-notifications.js', { asDb: (db) => db, query: null, ERR, ...domainStatus, ...notificationCatalog, mobilePushDestinationFor: () => 'lms', sendMobileEmployeePush: async (_db, input) => sends.push(input) });
  const db = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: sql.includes('COUNT') ? [{ n: 0, total: 0 }] : [] }; } };
  await domain.listCandidateNotifications(db, { companyId: 2, candidateId: 20, id: '99' });
  assert.deepEqual([...calls[0].values], [2, 20, 20, 0, '99']); assert.match(calls[0].sql, /company_id = \$1 AND recipient_candidate_id = \$2\s+AND id = \$5/);
  const fanoutDb = { query: async (sql) => sql.includes('FROM candidates') ? { rows: [{ id: 10 }, { id: 20 }] } : { rowCount: 1, rows: [{ id: '99', candidateId: 20 }] } };
  await domain.notifyCandidates(fanoutDb, { companyId: 2, candidateIds: [10, 20], type: notificationCatalog.EMPLOYEE_NOTIF.LMS_ENROLLED, dedupeKeyPrefix: 'test' });
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(sends.length, 1); assert.equal(sends[0].candidateId, 20); assert.equal(sends[0].notificationId, '99'); assert.equal(sends[0].companyId, 2);
});
