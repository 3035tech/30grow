import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as status from '../../lib/domain-status.js';
import * as permissions from '../../lib/identity/permissions.js';
import * as magic from '../../lib/file-magic.js';
import * as dpUpload from '../../lib/assessment/dp-upload-validation.js';
import * as auditChanges from '../../lib/audit-changes.js';
import { ERR, httpStatusForError } from '../../lib/api-error-codes.js';
import { privateAttachmentResponse } from '../../lib/private-attachment-response.js';
import { normalizeDependentRelation, normalizeEmergencyRelation } from '../../lib/kinship-relation.js';

const managerRoute = 'app/api/admin/candidates/[id]/dp/documents/[docKey]/file/route.js';
const employeeRoute = 'app/api/employee/dp/documents/[docKey]/file/route.js';
const leaveRoute = 'app/api/employee/dp/leave/[id]/file/route.js';
const documentParams = { id: '10', docKey: 'address_proof' };
const bytes = Buffer.from('%PDF-1.4 synthetic test');

// Execute real handlers, download domain and response/rate gate. Only session,
// SQL, storage, audit persistence and unrelated domain imports are substituted.
async function fixture(options = {}) {
  const state = { sql: [], storage: [], audit: [], mutations: [], rateKeys: [] };
  const companyId = options.companyId ?? 1;
  const candidateId = companyId * 10;
  const manager = options.anonymous ? null : { userId: 7, role: options.role || 'hr', companyId };
  const employee = options.anonymous ? null : { companyId, candidateId };
  const context = vm.createContext({ Buffer, Response, console });
  async function load(file, dependencies) {
    const mod = new vm.SourceTextModule(await readFile(new URL(`../../${file}`, import.meta.url), 'utf8'), { context });
    await mod.link(() => new vm.SyntheticModule(Object.keys(dependencies), function () {
      for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value);
    }, { context }));
    await mod.evaluate();
    return mod.namespace;
  }
  const result = rows => ({ rows, rowCount: rows.length });
  const query = async (sql, values) => {
    state.sql.push({ sql, values: [...values] });
    if (sql.includes('FROM candidates')) {
      assert.match(sql, /company_id = \$2/);
      return result(Number(values[0]) === candidateId && Number(values[1]) === companyId
        ? [{ id: candidateId, companyId, employmentStatus: 'employee' }] : []);
    }
    if (sql.includes('FROM employee_dp_documents')) {
      assert.match(sql, /company_id = \$1 AND candidate_id = \$2 AND doc_key = \$3/);
      assert.deepEqual([...values], [companyId, candidateId, 'address_proof']);
      return result([{ fileKey: options.tampered ? 'companies/999/private.pdf' : `companies/${companyId}/dp-docs/${candidateId}/address_proof/test.pdf`, fileName: 'Test.pdf' }]);
    }
    if (sql.includes('FROM employee_leave_requests')) {
      assert.match(sql, /id = \$1 AND company_id = \$2 AND candidate_id = \$3/);
      assert.deepEqual([...values].slice(1), [companyId, candidateId]);
      return result(Number(values[0]) === 5 ? [{ fileKey: `companies/${companyId}/dp-leave/${candidateId}/5/test.pdf`, fileName: 'Leave.pdf' }] : []);
    }
    throw new Error('Unexpected SQL in security test');
  };
  const apiError = (_request, code, statusCode) => Response.json({ errorCode: code }, { status: statusCode });
  const apiErrorFromResult = (request, value) => apiError(request, value.errorCode, httpStatusForError(value.errorCode, 400));
  const common = {
    ...status, ...magic, ...permissions, ERR, httpStatusForError, apiError, apiErrorFromResult,
    ...dpUpload, ...auditChanges, default: crypto, asDb: db => db, DP_ADDRESS_NUMBER_MAX_LENGTH: 20,
    companyScopedObjectKey: (id, suffix) => `companies/${id}/${suffix}`,
    getObjectBytes: async key => {
      state.storage.push(key);
      if (options.storageFailure) throw new Error('private storage diagnostics');
      return { body: bytes, contentType: 'application/pdf' };
    },
    putObject: async () => {}, deleteObjectBestEffort: async () => {}, isObjectStorageConfigured: () => true,
    leaveInclusiveDays: () => 1, expandLeaveCalendarByDay: () => [], sanitizeRichTextHtml: value => value,
    stripCep: value => value, stripCpf: value => value, stripPhone: value => value,
    normalizeDependentRelation, normalizeEmergencyRelation,
    DB_FANOUT_CONCURRENCY: 4,
    privateAttachmentResponse,
    checkRateLimit: async key => { state.rateKeys.push(key); return { ok: !options.rateLimited }; },
  };
  const domain = await load('lib/people/employee-dp.js', common);
  const download = await load('lib/people/dp-download-response.js', common);
  const mutation = name => async (_db, input) => {
    state.mutations.push({ name, input });
    return options.locked ? { ok: false, errorCode: ERR.DP_SIGNATURE_LOCKED } : { ok: true, item: { id: 5 } };
  };
  const deps = {
    ...common, ...domain, ...download, query,
    NextResponse: { json: (...args) => Response.json(...args) },
    getSessionPayload: async () => manager, getEmployeeSessionPayload: async () => employee,
    getManagerScope: payload => ({ authorized: !!payload, isAdmin: payload?.role === 'admin', companyId: payload?.companyId }),
    requireAnyCapability: (payload, caps) => !options.noCapability && permissions.requireAnyCapability(payload, caps),
    zPositiveInt: { safeParse: value => ({ success: Number.isSafeInteger(Number(value)) && Number(value) > 0, data: Number(value) }) },
    auditFromRequest: async (_request, entry) => state.audit.push(entry),
    AUDIT_ACTOR_KIND: { EMPLOYEE: 'employee' },
    uploadDpDocumentFile: mutation('upload'), clearDpDocumentFile: mutation('delete'),
    uploadLeaveAttachment: mutation('leave-upload'), clearLeaveAttachment: mutation('leave-delete'),
    getEmployeeDisplayName: async () => 'Synthetic employee', notifyCompanyManagers: async () => {},
    NOTIF: { DP_DOC_UPLOADED: 'uploaded', DP_LEAVE_FILE: 'leave-uploaded' },
  };
  return { state, manager: await load(managerRoute, deps), employee: await load(employeeRoute, deps), leave: await load(leaveRoute, deps) };
}

const request = (method = 'GET') => {
  const init = { method };
  if (method === 'POST') {
    init.body = new FormData();
    init.body.set('file', new Blob([bytes], { type: 'application/pdf' }), 'Synthetic.pdf');
  }
  return new Request('https://app.example.test/file?companyId=999&candidateId=999', init);
};
const invoke = (route, method = 'GET', params = documentParams) => route[method](request(method), { params: Promise.resolve(params) });

test('both tenants download only their own document bytes with private headers and async params', async () => {
  for (const companyId of [1, 2]) {
    const f = await fixture({ companyId });
    for (const route of [f.manager, f.employee]) {
      const response = await invoke(route, 'GET', { ...documentParams, id: String(companyId * 10) });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), bytes.toString());
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('location'), null);
      assert.match(response.headers.get('content-disposition'), /^attachment;/);
    }
    assert.equal(f.state.storage.length, 2);
  }
});

test('all file methods reject missing sessions before SQL, storage or mutation', async () => {
  const f = await fixture({ anonymous: true });
  for (const route of [f.manager, f.employee, f.leave]) {
    for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await invoke(route, method)).status, 401);
  }
  assert.equal(f.state.sql.length + f.state.storage.length + f.state.mutations.length + f.state.audit.length, 0);
});

test('manager cannot read, upload or remove another tenant document', async () => {
  const f = await fixture();
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await invoke(f.manager, method, { ...documentParams, id: '20' })).status, 404);
  }
  assert.equal(f.state.storage.length + f.state.mutations.length + f.state.audit.length, 0);
});

test('manager lacking the module cannot download', async () => {
  const f = await fixture({ noCapability: true });
  assert.equal((await invoke(f.manager)).status, 403);
  assert.equal(f.state.sql.length, 0);
});

test('tenant-bound admins cannot access documents from another company', async () => {
  const f = await fixture({ role: 'admin' });
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await invoke(f.manager, method, { ...documentParams, id: '20' })).status, 404);
  }
  assert.equal(f.state.storage.length + f.state.mutations.length + f.state.audit.length, 0);
});

test('unknown document keys and malformed candidate ids never reach data', async () => {
  const f = await fixture();
  for (const method of ['GET', 'POST', 'DELETE']) {
    for (const route of [f.manager, f.employee]) {
      assert.equal((await invoke(route, method, { id: '10', docKey: '../other' })).status, 400);
    }
    assert.equal((await invoke(f.manager, method, { ...documentParams, id: 'abc' })).status, 400);
  }
  assert.equal(f.state.sql.length + f.state.mutations.length, 0);
});

test('foreign storage keys are denied before fetching bytes', async () => {
  const f = await fixture({ tampered: true });
  assert.equal((await invoke(f.manager)).status, 401);
  assert.equal((await invoke(f.employee)).status, 401);
  assert.equal(f.state.storage.length, 0);
});

test('download rate denial prevents storage access; storage errors remain generic', async () => {
  const limited = await fixture({ rateLimited: true });
  assert.equal((await invoke(limited.employee)).status, 429);
  assert.equal(limited.state.storage.length, 0);
  const failing = await fixture({ storageFailure: true });
  const response = await invoke(failing.employee);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { errorCode: 'INTERNAL' });
});

test('employee leave download ignores forged identity and hides a foreign leave', async () => {
  const f = await fixture();
  assert.equal((await invoke(f.leave, 'GET', { id: '5' })).status, 200);
  assert.equal((await invoke(f.leave, 'GET', { id: '6' })).status, 404);
  assert.equal(f.state.storage.length, 1);
});

test('successful document uploads/removals record actor, tenant and key without bytes/URLs', async () => {
  const f = await fixture();
  for (const route of [f.manager, f.employee]) {
    for (const method of ['POST', 'DELETE']) assert.equal((await invoke(route, method)).status, 200);
  }
  assert.equal(f.state.audit.length, 4);
  for (const entry of f.state.audit) {
    assert.equal(entry.companyId, 1);
    assert.equal(Number(entry.targetId), 10);
    assert.deepEqual(Object.keys(entry.metadata), ['docKey']);
    assert.ok(['dp.document.file_uploaded', 'dp.document.file_removed'].includes(entry.action));
  }
  assert.equal(f.state.audit[0].actorUserId, 7);
  assert.equal(f.state.audit[2].actorCandidateId, 10);
  assert.equal(f.state.audit[2].actorKind, 'employee');
});

test('locked document mutation never emits a success audit', async () => {
  const f = await fixture({ locked: true });
  for (const route of [f.manager, f.employee]) {
    for (const method of ['POST', 'DELETE']) {
      assert.equal((await (await invoke(route, method)).json()).errorCode, 'DP_SIGNATURE_LOCKED');
    }
  }
  assert.equal(f.state.audit.length, 0);
});

test('employee leave writes await route params and bind identity to the session', async () => {
  const f = await fixture();
  for (const method of ['POST', 'DELETE']) assert.equal((await invoke(f.leave, method, { id: '5' })).status, 200);
  for (const { input } of f.state.mutations) {
    assert.equal(input.id, 5);
    assert.equal(input.companyId, 1);
    assert.equal(input.candidateId, 10);
  }
});
