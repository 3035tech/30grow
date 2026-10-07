import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { auditAccess, tenantAuditEntry, auditCsv } from '../../lib/audit-access.js';
import { CAP, can, canAccessDashboardTab } from '../../lib/permissions.js';
import { listAuditLogEntries } from '../../lib/audit-log-admin.js';
import { ERR, HTTP_STATUS } from '../../lib/api-error-codes.js';
const owner = { userId: 10, role: 'direction', companyId: 7, companyOwner: true, companyModules: ['core'], capabilitiesCustomized: true, capabilityOverrides: [] };

test('audit capability is reserved for owners and platform superadmins, never ordinary HR or tenant admins', () => {
  assert.equal(can(owner, CAP.AUDIT_VIEW), true);
  assert.equal(canAccessDashboardTab(owner, 'audit'), true);
  assert.equal(auditAccess(owner).companyId, 7);
  for (const payload of [null, { ...owner, companyOwner: false }, { ...owner, role: 'admin', companyOwner: false }, { ...owner, companyId: null }]) assert.equal(auditAccess(payload), null);
  assert.equal(auditAccess({ role: 'admin', companyId: null }).tenantOnly, false);
});
test('owner response contains field names only and never metadata/IP or previous values', () => {
  const row = tenantAuditEntry({ id: 1, requestIp: 'private', metadata: { token: 'secret', changes: [{ field: 'cpf', from: 'private', to: 'private' }, null] } });
  assert.equal(JSON.stringify(row).includes('private'), false);
  assert.equal(JSON.stringify(row).includes('secret'), false);
  assert.deepEqual(row.metadata.changes, [{ field: 'cpf' }]);
  assert.equal(auditCsv([{ action: '=HYPERLINK("evil")', targetId: 'line\n"quote' }]).includes("'=HYPERLINK"), true);
});
test('listing binds tenant, person and action; export has a hard cap', async () => {
  const calls = [];
  const db = { query: async (sql, values) => { calls.push({ sql, values: [...values] }); return sql.includes('COUNT') ? { rows: [{ n: 6000 }] } : { rows: [] }; } };
  const result = await listAuditLogEntries(db, { companyId: '7', targetId: '123', targetType: 'candidate', action: 'dp.profile.updated', export: true });
  assert.deepEqual(calls[0].values, [7, '123', 'candidate', 'dp.profile.updated']);
  assert.match(calls[1].sql, /a.company_id = \$1/);
  assert.deepEqual(calls[1].values.slice(-2), [5000, 0]);
  assert.equal(result.truncated, true);
});
test('HTTP audit list and CSV override malicious company selection using the authenticated owner tenant', async () => {
  let payload = owner;
  const calls = [];
  const deps = { cookies: async () => ({ get: () => ({ value: 'session' }) }), COOKIE_NAME: 'cookie', query: () => {},
    verifySessionWithCapabilities: async () => payload, auditAccess, tenantAuditEntry, auditCsv, ERR, HTTP_STATUS,
    apiError: (_req, code, status) => ({ code, status }), checkRateLimit: async () => ({ ok: true }), clientIpFromRequest: () => 'test', auditFromRequest: async () => {},
    listAuditLogEntries: async (_db, options) => { calls.push(options); return { items: [{ id: 1, companyId: 7, requestIp: 'hidden', metadata: { secret: true } }], truncated: false }; },
  };
  const context = vm.createContext({ URL, Response, console });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../app/api/admin/audit-log/route.js', import.meta.url), 'utf8'), { context });
  await mod.link(async () => new vm.SyntheticModule(Object.keys(deps), function () { for (const [k,v] of Object.entries(deps)) this.setExport(k,v); }, { context }));
  await mod.evaluate();
  for (const company of ['99', 'all', 'invalid']) {
    const response = await mod.namespace.GET({ url: `https://example.com/audit?companyId=${company}` });
    assert.equal(calls.at(-1).companyId, '7');
    assert.equal((await response.json()).items[0].requestIp, undefined);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  const csv = await mod.namespace.GET({ url: 'https://example.com/audit?companyId=99&format=csv' });
  assert.equal(calls.at(-1).companyId, '7'); assert.equal(csv.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  payload = { ...owner, companyOwner: false };
  assert.equal((await mod.namespace.GET({ url: 'https://example.com/audit' })).status, 403);
  payload = null; assert.equal((await mod.namespace.GET({ url: 'https://example.com/audit' })).status, 401);
});
