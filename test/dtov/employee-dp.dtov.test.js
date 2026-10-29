/**
 * DTOV proof — light DP profile, documents, leave, calendar pulse.
 */
import assert from 'node:assert/strict';
import { query, pool } from '../../lib/db.js';
import {
  DP_DOCUMENT_STATUS,
  DP_LEAVE_STATUS,
  DP_LEAVE_TYPE,
  EMPLOYMENT_STATUS,
} from '../../lib/domain-status.js';
import { expandLeaveCalendarByDay, leaveInclusiveDays } from '../../lib/leave-days.js';
import {
  buildLeaveExportCsv,
  cancelEmployeeLeaveRequest,
  createLeaveRequest,
  ensureDpDocuments,
  getDpAttentionPulse,
  getDpProfile,
  getEmployeeDpHome,
  getLeaveBalance,
  listLeaveCalendar,
  listLeaveRequests,
  parseLeaveListParams,
  updateDpDocument,
  updateLeaveRequest,
  upsertDpProfile,
  upsertLeaveBalance,
} from '../../lib/people/employee-dp.js';
import {
  NOTIF,
  notificationCopySpec,
  notificationHref,
} from '../../lib/manager-notification-catalog.js';
import { notifyCompanyManagers } from '../../lib/manager-notifications.js';

async function main() {
  assert.equal(leaveInclusiveDays('2030-01-10', '2030-01-20'), 11);

  const expanded = expandLeaveCalendarByDay(
    [{ id: 1, startsOn: '2030-01-10', endsOn: '2030-01-12' }],
    '2030-01-09',
    '2030-01-15'
  );
  assert.equal(expanded.length, 3);
  assert.equal(expanded[0][0], '2030-01-10');
  assert.equal(expanded[2][0], '2030-01-12');

  const parsed = parseLeaveListParams({
    page: '2',
    pageSize: '10',
    status: 'requested',
    leaveType: 'vacation',
    q: 'ana',
  });
  assert.equal(parsed.page, 2);
  assert.equal(parsed.pageSize, 10);
  assert.equal(parsed.status, 'requested');
  assert.equal(parsed.leaveType, 'vacation');
  assert.equal(parsed.q, 'ana');

  const emp = await query(
    `SELECT c.id AS "candidateId", c.company_id AS "companyId"
     FROM candidates c
     WHERE c.employment_status = $1
       AND c.email ILIKE '%@todos-os-dados.demo'
     ORDER BY c.id ASC
     LIMIT 1`,
    [EMPLOYMENT_STATUS.EMPLOYEE]
  );
  assert.ok(emp.rowCount > 0, 'need demo employee candidate');
  const { candidateId, companyId } = emp.rows[0];

  const hr = await query(
    `SELECT u.id AS "userId"
     FROM users u
     WHERE u.email = 'hr@todos-os-dados.demo' AND u.deleted = FALSE
     LIMIT 1`
  );
  assert.ok(hr.rowCount > 0, 'need demo HR user');
  const userId = hr.rows[0].userId;

  const ensured = await ensureDpDocuments({ query }, { companyId, candidateId });
  assert.equal(ensured.ok, true, ensured.errorCode);

  const profile = await upsertDpProfile({ query }, {
    companyId,
    candidateId,
    emergencyName: 'DTOV Contato',
    emergencyPhone: '(11) 99999-0000',
    emergencyRelation: 'cônjuge',
    cpf: '529.982.247-25',
    addressLine: 'Rua Teste 1',
    addressCity: 'São Paulo',
    addressState: 'SP',
    addressPostal: '01001-000',
    internalNotes: 'nota dtov',
    userId,
  });
  assert.equal(profile.ok, true, profile.errorCode);
  assert.equal(profile.profile.cpf, '52998224725');
  assert.equal(profile.profile.addressPostal, '01001000');
  assert.equal(profile.profile.emergencyPhone, '11999990000');
  assert.equal(profile.profile.emergencyRelation, 'spouse');

  const loaded = await getDpProfile({ query }, { companyId, candidateId });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.profile.emergencyName, 'DTOV Contato');

  const doc = await updateDpDocument({ query }, {
    companyId,
    candidateId,
    docKey: 'id_document',
    status: DP_DOCUMENT_STATUS.RECEIVED,
    notes: 'ok dtov',
    userId,
  });
  assert.equal(doc.ok, true, doc.errorCode);
  assert.equal(doc.item.status, DP_DOCUMENT_STATUS.RECEIVED);

  await query(
    `UPDATE employee_dp_documents SET file_url = NULL, file_key = NULL
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = 'id_document'`,
    [companyId, candidateId]
  );

  const withoutFile = await updateDpDocument({ query }, {
    companyId, candidateId, docKey: 'id_document',
    status: DP_DOCUMENT_STATUS.REJECTED,
    rejectionReason: 'É necessário anexar um arquivo.', userId,
  });
  assert.equal(withoutFile.ok, false);

  await query(
    `UPDATE employee_dp_documents SET file_url = 'https://example.test/dtov-document'
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = 'id_document'`,
    [companyId, candidateId]
  );
  const withoutReason = await updateDpDocument({ query }, {
    companyId, candidateId, docKey: 'id_document',
    status: DP_DOCUMENT_STATUS.REJECTED, rejectionReason: '   ', userId,
  });
  assert.equal(withoutReason.ok, false);
  const rejected = await updateDpDocument({ query }, {
    companyId, candidateId, docKey: 'id_document',
    status: DP_DOCUMENT_STATUS.REJECTED,
    rejectionReason: 'O arquivo está ilegível. Envie uma nova cópia.', userId,
  });
  assert.equal(rejected.ok, true, rejected.errorCode);
  assert.equal(rejected.item.status, DP_DOCUMENT_STATUS.REJECTED);
  assert.equal(rejected.item.rejectionReason, 'O arquivo está ilegível. Envie uma nova cópia.');
  const employeeHome = await getEmployeeDpHome({ query }, { companyId, candidateId });
  assert.equal(employeeHome.ok, true);
  assert.equal(employeeHome.documents.find((item) => item.docKey === 'id_document').rejectionReason,
    'O arquivo está ilegível. Envie uma nova cópia.');
  const reopened = await updateDpDocument({ query }, {
    companyId, candidateId, docKey: 'id_document',
    status: DP_DOCUMENT_STATUS.RECEIVED, userId,
  });
  assert.equal(reopened.ok, true, reopened.errorCode);
  assert.equal(reopened.item.rejectionReason, '');

  const seedBal = await upsertLeaveBalance({ query }, {
    companyId,
    candidateId,
    entitlementDays: 90,
    adjustmentDays: 0,
    notes: 'dtov seed',
    periodStart: '2030-01-01',
    periodEnd: '2030-12-31',
    userId,
  });
  assert.equal(seedBal.ok, true, seedBal.errorCode);
  if (!seedBal.balance.legalAccrual) assert.equal(seedBal.balance.periodStart, '2030-01-01');
  assert.equal(seedBal.balance.customPeriod, true);

  const leave = await createLeaveRequest({ query }, {
    companyId,
    candidateId,
    leaveType: DP_LEAVE_TYPE.VACATION,
    startsOn: '2030-01-10',
    endsOn: '2030-01-20',
    reason: 'DTOV leave',
    requestedBy: 'employee',
    allowOverBalance: true,
  });
  assert.equal(leave.ok, true, leave.errorCode);
  assert.equal(leave.item.status, DP_LEAVE_STATUS.REQUESTED);

  const overlap = await createLeaveRequest({ query }, {
    companyId,
    candidateId,
    leaveType: DP_LEAVE_TYPE.SICK,
    startsOn: '2030-01-15',
    endsOn: '2030-01-16',
    reason: 'should overlap',
    requestedBy: 'employee',
  });
  assert.equal(overlap.ok, false);
  assert.equal(overlap.errorCode, 'LEAVE_OVERLAP');

  const balPending = await getLeaveBalance({ query }, { companyId, candidateId });
  assert.equal(balPending.ok, true, balPending.errorCode);
  assert.ok(balPending.balance.pendingDays >= 11);

  const listed = await listLeaveRequests({ query }, {
    companyId,
    status: DP_LEAVE_STATUS.REQUESTED,
    page: 1,
    pageSize: 20,
  });
  assert.ok(listed.items.some((r) => r.id === leave.item.id));

  const csv = buildLeaveExportCsv(listed.items.slice(0, 3));
  assert.ok(csv.includes('leave_type'));
  assert.ok(csv.includes('candidate_name'));

  const cancelledProbe = await createLeaveRequest({ query }, {
    companyId,
    candidateId,
    leaveType: DP_LEAVE_TYPE.UNPAID,
    startsOn: '2030-06-01',
    endsOn: '2030-06-02',
    reason: 'cancel me',
    requestedBy: 'employee',
  });
  assert.equal(cancelledProbe.ok, true, cancelledProbe.errorCode);
  const cancelled = await cancelEmployeeLeaveRequest({ query }, {
    id: cancelledProbe.item.id,
    companyId,
    candidateId,
  });
  assert.equal(cancelled.ok, true, cancelled.errorCode);
  assert.equal(cancelled.item.status, DP_LEAVE_STATUS.CANCELLED);

  for (const type of [
    NOTIF.DP_LEAVE_CANCELLED,
    NOTIF.DP_LEAVE_FILE,
    NOTIF.DP_DOC_UPLOADED,
  ]) {
    const spec = notificationCopySpec(type, { candidateName: 'Ana', docKey: 'aso', pending: 1 });
    assert.ok(spec.titleKey, type);
    assert.ok(notificationHref(type, { candidateId }), type);
  }

  const notifCancel = await notifyCompanyManagers(query, {
    companyId,
    type: NOTIF.DP_LEAVE_CANCELLED,
    entityType: 'leave',
    entityId: cancelledProbe.item.id,
    dedupeKey: `dtov_dp_leave_cancel:${cancelledProbe.item.id}`,
    payload: {
      candidateId,
      candidateName: 'DTOV',
      leaveId: cancelledProbe.item.id,
    },
  });
  assert.ok((notifCancel.inserted || 0) >= 1, 'cancel notif fan-out');

  const notCancel = await cancelEmployeeLeaveRequest({ query }, {
    id: cancelledProbe.item.id,
    companyId,
    candidateId,
  });
  assert.equal(notCancel.ok, false);
  assert.equal(notCancel.errorCode, 'LEAVE_NOT_CANCELLABLE');

  const decided = await updateLeaveRequest({ query }, {
    id: leave.item.id,
    companyId,
    status: DP_LEAVE_STATUS.APPROVED,
    managerNotes: 'ok',
    userId,
  });
  assert.equal(decided.ok, true, decided.errorCode);
  assert.equal(decided.item.status, DP_LEAVE_STATUS.APPROVED);

  const balUsed = await getLeaveBalance({ query }, { companyId, candidateId });
  assert.equal(balUsed.ok, true);
  assert.ok(balUsed.balance.usedDays >= 11);
  assert.equal(balUsed.balance.pendingDays, 0);

  const setBal = await upsertLeaveBalance({ query }, {
    companyId,
    candidateId,
    entitlementDays: 5,
    adjustmentDays: 0,
    notes: 'dtov low',
    periodStart: '2031-01-01',
    periodEnd: '2031-12-31',
    userId,
  });
  assert.equal(setBal.ok, true, setBal.errorCode);
  assert.equal(setBal.balance.legalAccrual ? setBal.balance.periods[0].entitlementDays : setBal.balance.entitlementDays, 5);
  if (!setBal.balance.legalAccrual) assert.equal(setBal.balance.periodStart, '2031-01-01');

  const over = await createLeaveRequest({ query }, {
    companyId,
    candidateId,
    leaveType: DP_LEAVE_TYPE.VACATION,
    startsOn: '2031-02-01',
    endsOn: '2031-08-19',
    reason: 'should fail',
    requestedBy: 'employee',
  });
  assert.equal(over.ok, false);
  assert.equal(over.errorCode, 'LEAVE_BALANCE_EXCEEDED');

  const forced = await createLeaveRequest({ query }, {
    companyId,
    candidateId,
    leaveType: DP_LEAVE_TYPE.VACATION,
    startsOn: '2031-03-01',
    endsOn: '2031-03-02',
    reason: 'hr exception',
    requestedBy: 'manager',
    autoApprove: true,
    allowOverBalance: true,
    userId,
  });
  assert.equal(forced.ok, true, forced.errorCode);

  const cal = await listLeaveCalendar({ query }, {
    companyId,
    from: '2030-01-01',
    to: '2030-01-31',
  });
  assert.ok(cal.items.some((r) => r.id === leave.item.id));
  assert.ok(Array.isArray(cal.byDay));
  assert.ok(cal.byDay.some(([d]) => d === '2030-01-15'));

  const pulse = await getDpAttentionPulse({ query }, { companyId });
  assert.ok(Array.isArray(pulse.pendingDocs));
  assert.ok(Array.isArray(pulse.leaves));

  console.log('employee-dp.dtov.test.js OK');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  });
