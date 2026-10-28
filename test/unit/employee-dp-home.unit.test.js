import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import * as status from '../../lib/domain-status.js';
import * as magic from '../../lib/file-magic.js';
import { ERR } from '../../lib/api-error-codes.js';
import { DP_ADDRESS_NUMBER_MAX_LENGTH } from '../../lib/assessment/dp-profile-constants.js';
import * as dpUpload from '../../lib/assessment/dp-upload-validation.js';
import * as auditChanges from '../../lib/audit-changes.js';
import { normalizeDependentRelation, normalizeEmergencyRelation } from '../../lib/kinship-relation.js';

// Exercise the real aggregator AND listLeaveRequests; only external dependencies/SQL are mocked.
const dependencies = {
  ...status, ...magic, ...dpUpload, ...auditChanges, ERR, DP_ADDRESS_NUMBER_MAX_LENGTH, default: crypto, asDb: (db) => db,
  companyScopedObjectKey: () => '', getObjectBytes: async () => {}, putObject: async () => {},
  deleteObjectBestEffort: async () => {}, isObjectStorageConfigured: () => false,
  leaveInclusiveDays: () => 1, expandLeaveCalendarByDay: () => [],
  sanitizeRichTextHtml: (value) => value, stripCep: (value) => value,
  stripCpf: (value) => value, stripPhone: (value) => value,
  normalizeDependentRelation, normalizeEmergencyRelation,
  calculateVacationAccrual: () => null,
  DB_FANOUT_CONCURRENCY: 4,
};
const context = vm.createContext({ Buffer });
const module = new vm.SourceTextModule(await readFile(new URL('../../lib/people/employee-dp.js', import.meta.url), 'utf8'), { context });
await module.link(async () => new vm.SyntheticModule(Object.keys(dependencies), function () {
  for (const [name, value] of Object.entries(dependencies)) this.setExport(name, value);
}, { context }));
await module.evaluate();
const { getEmployeeDpHome, listLeaveRequests } = module.namespace;

function database({ companyId = 1, candidateId = 10, leaves = [], missingEmployee = false, failure = null } = {}) {
  const calls = [];
  return { calls, query: async (sql, values) => {
    calls.push({ sql, values });
    const result = (rows) => ({ rows, rowCount: rows.length });
    if (sql.includes('FROM candidates') && !sql.includes('JOIN candidates')) {
      assert.deepEqual([...values], [candidateId, companyId]);
      return result(missingEmployee ? [] : [{ id: candidateId, companyId, employmentStatus: status.EMPLOYMENT_STATUS.EMPLOYEE, fullName: 'Example' }]);
    }
    if (sql.includes('FROM employee_leave_requests l')) {
      assert.match(sql, /l.company_id = \$1 AND l.candidate_id = \$2/);
      assert.deepEqual([...values].slice(0, 2), [companyId, candidateId]);
      if (failure) throw failure;
      return result(sql.includes('COUNT(*)') ? [{ n: leaves.length }] : leaves);
    }
    if (sql.includes('FROM employee_dp_documents')) return result([{ id: 1, companyId, candidateId, docKey: status.DP_DOCUMENT_KEY.CONTRACT, status: status.DP_DOCUMENT_STATUS.PENDING, notes: 'Internal note', signatureStatus: status.DP_DOCUMENT_SIGNATURE_STATUS.NONE }]);
    if (sql.includes('FROM employee_leave_requests')) return result([{ usedDays: 0, pendingDays: 0 }]);
    return result([]);
  } };
}

test('empty leave list without an ok field is a successful DP home', async () => {
  const db = database();
  const listed = await listLeaveRequests(db, { companyId: 1, candidateId: 10 });
  assert.equal(listed.ok, undefined);
  assert.equal(listed.items.length, 0);
  const home = await getEmployeeDpHome(db, { companyId: 1, candidateId: 10 });
  assert.equal(home.ok, true);
  assert.equal(home.leaves.length, 0);
  assert.equal(home.profile.fullName, 'Example');
  assert.equal(home.profile.internalNotes, undefined);
  assert.equal(home.documents[0].notes, '');
  assert.equal(home.balance.availableDays, 30);
  assert.equal(home.badge, 1);
});
test('populated leave list preserves statuses, badges and tenant A/B filters', async () => {
  for (const companyId of [1, 2]) {
    const candidateId = companyId * 10;
    const leaves = [status.DP_LEAVE_STATUS.REQUESTED, status.DP_LEAVE_STATUS.APPROVED, status.DP_LEAVE_STATUS.CANCELLED].map((leaveStatus, index) => ({ id: index + 1, companyId, candidateId, leaveType: status.DP_LEAVE_TYPE.VACATION, status: leaveStatus, startsOn: '2026-10-01', endsOn: '2026-10-02', reason: 'Example' }));
    const home = await getEmployeeDpHome(database({ companyId, candidateId, leaves }), { companyId, candidateId });
    assert.equal(home.ok, true);
    assert.equal(home.leaves.length, 3);
    assert.equal(home.leaves[0].reason, 'Example');
    assert.equal(home.openLeaves, 2);
    assert.equal(home.pendingDocs, 1);
    assert.equal(home.badge, 3);
  }
});
test('missing employee is denied before DP data access', async () => {
  const db = database({ missingEmployee: true });
  const home = await getEmployeeDpHome(db, { companyId: 1, candidateId: 10 });
  assert.equal(home.ok, false);
  assert.equal(home.errorCode, ERR.NOT_FOUND);
  assert.equal(db.calls.length, 1);
});
test('real SQL failures propagate instead of becoming an empty successful home', async () => {
  const failure = new Error('simulated database failure');
  await assert.rejects(getEmployeeDpHome(database({ failure }), { companyId: 1, candidateId: 10 }), (error) => error === failure);
});
