import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';
import { EMPLOYEE_NOTIF } from '../../lib/employee-notification-catalog.js';
import { DP_DOCUMENT_KEYS } from '../../lib/domain-status.js';

async function moduleAt(path, dependencies) {
  const context = vm.createContext({ URL, console, queueMicrotask });
  const module = new vm.SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () { for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value); }, { context }));
  await module.evaluate(); return module.namespace;
}
const target = await moduleAt('../../lib/mobile-notification-target.js', { EMPLOYEE_NOTIF, DP_DOCUMENT_KEYS });
test('closed target mapping preserves IDs and never exposes URLs/tokens or incorrect entity IDs', () => {
  const rows = [
    [EMPLOYEE_NOTIF.LMS_ENROLLED, 'lms_course', 'course'], [EMPLOYEE_NOTIF.LMS_OVERDUE, 'lms_enrollment', 'enrollment'],
    [EMPLOYEE_NOTIF.PDI_UPDATED, 'development_plan', 'plan'], [EMPLOYEE_NOTIF.OKR_ACTIVITY_ASSIGNED, 'okr_activity', 'okr'],
    [EMPLOYEE_NOTIF.KUDOS_RECEIVED, 'company_kudo', 'kudo'], [EMPLOYEE_NOTIF.MOTIVATORS_INVITE, 'ae_invite', 'invite'],
  ];
  for (const [type, entityType, kind] of rows) {
    assert.equal(JSON.stringify(target.mobileNotificationTarget({ type, entityType, entityId: 22, payload: { assessmentUrl: 'https://example.com/token' } })), JSON.stringify({ kind, id: '22' }));
    assert.equal(target.mobileNotificationTarget({ type, entityType: 'candidate', entityId: 22 }), null);
  }
  assert.equal(target.mobileNotificationTarget({ type: EMPLOYEE_NOTIF.MOTIVATORS_INVITE, entityType: 'ae_invite', entityId: '9007199254740993' }).id, '9007199254740993');
  assert.equal(target.mobileNotificationTarget({ type: EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED, payload: { docKey: 'contract' } }).id, 'contract');
  assert.equal(target.mobileNotificationTarget({ type: EMPLOYEE_NOTIF.DP_DOC_REMINDER, payload: { pending: 2 } }), null);
  assert.equal(target.mobileNotificationTarget({ type: EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED, payload: { docKey: '__proto__' } }), null);
  assert.equal(target.mobileNotificationTarget({ type: EMPLOYEE_NOTIF.FEEDBACK_REQUESTED, payload: { requestId: 'https://evil.example' } }), null);
});

async function setup(session) {
  const calls = [];
  const route = await moduleAt('../../app/api/mobile/v1/employee/notifications/route.js', {
    NextResponse: { json: (body, options) => ({ body, ...options }) }, z,
    apiError: (_request, code, status) => ({ code, status }), apiErrorFromResult: (_request, result) => result,
    HTTP_STATUS: { UNAUTHORIZED: 401, BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 }, ERR: { UNAUTHORIZED: 'UNAUTHORIZED', INVALID_DATA: 'INVALID_DATA', INTERNAL: 'INTERNAL' },
    authenticateMobileEmployee: async () => session, mobileEmployeeBearerToken: () => 'test',
    listCandidateNotifications: async (_db, options) => { calls.push(options); return { ok: true, total: 81, unreadCount: 1, items: [{ id: 8, type: EMPLOYEE_NOTIF.MOTIVATORS_INVITE, entityType: 'ae_invite', entityId: '22', createdAt: '2026-09-19T00:00:00Z', readAt: null, copy: { titleKey: 'title', bodyKey: 'body', values: {} } }] }; },
    markCandidateNotificationRead: async (_db, options) => { calls.push(options); return { ok: true }; },
    mobilePushDestinationFor: () => 'today',
    normalizeMobilePushDestinations: (list) => (Array.isArray(list) ? list : []),
    resolveMobilePushDestination: (preferred) => preferred,
    mobileNotificationTarget: target.mobileNotificationTarget, t: (_locale, key) => key,
  }); return { route, calls };
}
test('legacy destination remains compatible; opt-in page/targets are tenant-scoped and no-store', async () => {
  for (const companyId of [1, 2]) {
    const { route, calls } = await setup({ companyId, candidateId: companyId * 10 });
    const legacy = await route.GET({ url: 'https://example.com/notifications' });
    assert.equal(legacy.body.items[0].destination, 'today'); assert.equal(legacy.body.items[0].target, undefined);
    const result = await route.GET({ url: 'https://example.com/notifications?context=1&page=2' });
    assert.equal(result.body.items[0].target.kind, 'invite'); assert.equal(result.body.pagination.totalPages, 3);
    assert.equal(result.headers['Cache-Control'], 'no-store'); assert.equal(calls[1].offset, 40);
    const marked = await route.PATCH({ url: 'https://example.com/notifications?context=1&page=2', json: async () => ({ id: 8 }) });
    assert.equal(marked.body.pagination.page, 2);
    assert.ok(calls.every((call) => call.companyId === companyId && call.candidateId === companyId * 10));
  }
});
test('anonymous/invalid/duplicate/tenant-injected requests fail before data access', async () => {
  assert.equal((await (await setup(null)).route.GET({})).status, 401);
  const { route, calls } = await setup({ companyId: 1, candidateId: 10 });
  for (const query of ['page=0', 'page=10001', 'page=1&page=2', 'companyId=2', 'context=2', 'page=1.5']) assert.equal((await route.GET({ url: `https://example.com/notifications?${query}` })).status, 400);
  for (const body of [{}, { id: 1, companyId: 2 }, { id: 1, markAll: true }]) assert.equal((await route.PATCH({ url: 'https://example.com/notifications', json: async () => body })).status, 400);
  assert.equal(calls.length, 0);
});
test('domain pagination SQL binds employee and company; deterministic ordering and filtered counts', async () => {
  const calls = [];
  const domain = await moduleAt('../../lib/employee-notifications.js', {
    asDb: (db) => db, query: null, ERR: { UNAUTHORIZED: 'UNAUTHORIZED' }, EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' },
    t: () => '', mobilePushDestinationFor: () => 'today', sendMobileEmployeePush: async () => {},
    EMPLOYEE_NOTIF, EMPLOYEE_NOTIF_TYPES: new Set(), employeeNotificationCopySpec: () => ({}), employeeNotificationHref: () => '',
  });
  const result = await domain.listCandidateNotifications({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: sql.includes('COUNT') ? [{ n: 2, total: 81 }] : [] }; } }, { companyId: 2, candidateId: 20, limit: 40, offset: 40 });
  assert.deepEqual([...calls[0].values], [2, 20, 40, 40]); assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/);
  assert.ok(calls.every(({ sql }) => sql.includes('company_id = $1 AND recipient_candidate_id = $2')));
  assert.equal(result.total, 81); assert.equal(result.unreadCount, 2);
});
test('kudo lookup binds tenant and ID in count and list, excluding deleted rows', async () => {
  const calls = [];
  const domain = await moduleAt('../../lib/company-kudos.js', { asDb: (db) => db, query: null, ERR: { INVALID_DATA: 'INVALID_DATA' }, EMPLOYMENT_STATUS: { EMPLOYEE: 'employee' } });
  const db = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: sql.includes('COUNT') ? [{ n: 0 }] : [] }; } };
  await domain.listCompanyKudos(db, { companyId: 2, kudoId: 55, pageSize: 15 });
  assert.deepEqual([...calls[0].values], [2, 55]); assert.deepEqual([...calls[1].values], [2, 55, 15, 0]);
  assert.ok(calls.every(({ sql }) => sql.includes('k.company_id = $1') && sql.includes('k.deleted = FALSE') && sql.includes('k.id = $2')));
});
