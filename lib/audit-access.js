import { CAP, can, isSuperAdminPayload, isCompanyOwnerPayload } from './permissions.js';

export function auditAccess(payload) {
  if (!payload || !can(payload, CAP.AUDIT_VIEW)) return null;
  if (isSuperAdminPayload(payload)) return { tenantOnly: false, companyId: null };
  const companyId = Number(payload.companyId ?? payload.company_id);
  return isCompanyOwnerPayload(payload) && Number.isSafeInteger(companyId) && companyId > 0
    ? { tenantOnly: true, companyId } : null;
}

// Company owners see events and changed field names, not raw metadata/IP or old values.
export function tenantAuditEntry(row) {
  const { requestIp, metadata, ...publicRow } = row;
  return { ...publicRow, metadata: {
    changes: Array.isArray(metadata?.changes)
      ? metadata.changes.filter((change) => typeof change?.field === 'string').map(({ field }) => ({ field }))
      : [],
  } };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function auditCsv(items) {
  const columns = ['id', 'createdAt', 'actorKind', 'actorUserId', 'actorCandidateId', 'action', 'targetType', 'targetId', 'companyId'];
  return '\uFEFF' + [columns, ...items.map((row) => columns.map((key) => row[key]))].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
