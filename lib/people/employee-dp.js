/**
 * Lightweight DP — profile, document checklist, leave (not payroll / eSocial / time clock).
 */

import { DB_FANOUT_CONCURRENCY } from '../concurrency.js';
import crypto from 'node:crypto';
import { asDb } from '../ae/as-db.js';
import { DP_AUDIT_PRESENCE_FIELDS, diffAuditFields } from '../audit-changes.js';
import { ERR } from '../api-error-codes.js';
import {
  DP_DOCUMENT_KEY,
  DP_DOCUMENT_KEYS,
  DP_DOCUMENT_STATUS,
  DP_DOCUMENT_STATUSES,
  DP_DOCUMENT_SIGNATURE_STATUS,
  DP_LEAVE_STATUS,
  DP_LEAVE_STATUSES,
  DP_LEAVE_TYPE,
  DP_LEAVE_TYPES,
  EMPLOYMENT_STATUS,
} from '../domain-status.js';
import {
  companyScopedObjectKey,
  deleteObjectBestEffort,
  getObjectBytes,
  isObjectStorageConfigured,
  putObject,
} from '../s3-object-storage.js';
import { isPdfBuffer, detectImageMimeFromBuffer } from '../file-magic.js';
import { leaveInclusiveDays, expandLeaveCalendarByDay } from '../leave-days.js';
import { sanitizeRichTextHtml } from '../sanitize-html.js';
import { stripCep, stripCpf, stripPhone } from '../br-masks.js';
import { DP_ADDRESS_NUMBER_MAX_LENGTH } from '../dp-profile-constants.js';
import { normalizeDependentRelation, normalizeEmergencyRelation } from '../kinship-relation.js';

export { leaveInclusiveDays, expandLeaveCalendarByDay } from '../leave-days.js';

import { DP_DOC_MAX_BYTES, DP_DOC_ALLOWED_MIMES } from '../dp-upload-validation.js';
export { DP_DOC_MAX_BYTES, DP_DOC_ALLOWED_MIMES } from '../dp-upload-validation.js';
export const DP_LEAVE_REASON_MAX = 2000;

/** Consent text version for internal canvas + typed-name acknowledgment (B-2724). */
export const DP_SIGNATURE_CONSENT_VERSION = 'v1-internal-ack';
/** Max PNG data-URL length stored with the acknowledgment (~150KB raw). */
export const DP_SIGNATURE_STROKE_MAX_CHARS = 200000;

const DOC_SELECT = `id, company_id AS "companyId", candidate_id AS "candidateId",
            doc_key AS "docKey", status, notes,
            file_url AS "fileUrl", file_key AS "fileKey",
            file_name AS "fileName", updated_at AS "updatedAt",
            signature_status AS "signatureStatus",
            signature_requested_at AS "signatureRequestedAt",
            signed_at AS "signedAt",
            signer_name AS "signerName",
            signature_consent_version AS "signatureConsentVersion",
            signature_file_key AS "signatureFileKey",
            signer_stroke_png AS "signerStrokePng"`;

/** Default annual vacation entitlement when no balance row exists (BR-style baseline). */
export const DP_LEAVE_DEFAULT_ENTITLEMENT_DAYS = 30;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];

function dateOrNull(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function toDayNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function clip(s, max) {
  return String(s || '').trim().slice(0, max);
}

function normalizeDependents(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item) => ({
      name: clip(item?.name, 120),
      cpf: stripCpf(item?.cpf) || '',
      relation: normalizeDependentRelation(item?.relation),
      birthDate: dateOrNull(item?.birthDate),
    }))
    .filter((item) => item.name || item.cpf || item.relation || item.birthDate);
}

function emptyProfile(candidateId, companyId) {
  return {
    candidateId: Number(candidateId),
    companyId: Number(companyId),
    emergencyName: '',
    emergencyPhone: '',
    emergencyRelation: '',
    cpf: '',
    rg: '',
    dependents: [],
    addressLine: '',
    addressNumber: '',
    addressCity: '',
    addressState: '',
    addressPostal: '',
    internalNotes: '',
    updatedAt: null,
  };
}

function mapProfile(r) {
  return {
    candidateId: Number(r.candidateId),
    companyId: Number(r.companyId),
    emergencyName: r.emergencyName || '',
    emergencyPhone: r.emergencyPhone || '',
    emergencyRelation: normalizeEmergencyRelation(r.emergencyRelation),
    cpf: r.cpf || '',
    rg: r.rg || '',
    dependents: normalizeDependents(r.dependents),
    addressLine: r.addressLine || '',
    addressNumber: r.addressNumber || '',
    addressCity: r.addressCity || '',
    addressState: r.addressState || '',
    addressPostal: r.addressPostal || '',
    internalNotes: r.internalNotes || '',
    updatedAt: r.updatedAt || null,
  };
}

function mapDoc(r) {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    candidateId: Number(r.candidateId),
    docKey: r.docKey,
    status: r.status,
    notes: r.notes || '',
    fileUrl: r.fileUrl || null,
    fileName: r.fileName || '',
    hasFile: Boolean(r.fileKey || r.fileUrl),
    updatedAt: r.updatedAt || null,
    signatureStatus: r.signatureStatus || DP_DOCUMENT_SIGNATURE_STATUS.NONE,
    signatureRequestedAt: r.signatureRequestedAt || null,
    signedAt: r.signedAt || null,
    signerName: r.signerName || '',
    signatureConsentVersion: r.signatureConsentVersion || '',
    signatureFileKey: r.signatureFileKey || null,
    signerStrokePng: r.signerStrokePng || '',
  };
}

function mapLeave(r) {
  return {
    id: Number(r.id),
    companyId: Number(r.companyId),
    candidateId: Number(r.candidateId),
    leaveType: r.leaveType,
    status: r.status,
    startsOn: dateOrNull(r.startsOn),
    endsOn: dateOrNull(r.endsOn),
    reason: r.reason || '',
    managerNotes: r.managerNotes || '',
    requestedBy: r.requestedBy || 'manager',
    decidedAt: r.decidedAt || null,
    createdAt: r.createdAt || null,
    candidateName: r.candidateName || null,
    candidateEmail: r.candidateEmail || null,
    fileUrl: r.fileUrl || null,
    fileName: r.fileName || '',
    hasFile: Boolean(r.fileKey || r.fileUrl),
  };
}

/** Calendar-year entitlement window when balance has no explicit period. */
export function defaultLeavePeriod(refDate = new Date()) {
  const d =
    refDate instanceof Date && !Number.isNaN(refDate.getTime())
      ? refDate
      : new Date();
  const y = d.getUTCFullYear();
  return {
    periodStart: `${y}-01-01`,
    periodEnd: `${y}-12-31`,
  };
}

function resolveLeavePeriod(balanceRow, refDate) {
  const start = dateOrNull(balanceRow?.periodStart);
  const end = dateOrNull(balanceRow?.periodEnd);
  if (start && end && end >= start) {
    return { periodStart: start, periodEnd: end, customPeriod: true };
  }
  return { ...defaultLeavePeriod(refDate), customPeriod: false };
}

async function findLeaveOverlap(db, { companyId, candidateId, startsOn, endsOn, excludeId = null }) {
  const params = [companyId, candidateId, startsOn, endsOn];
  let exclude = '';
  if (excludeId != null && Number.isFinite(Number(excludeId))) {
    params.push(Number(excludeId));
    exclude = ` AND id <> $${params.length}`;
  }
  const r = await db.query(
    `SELECT id, starts_on AS "startsOn", ends_on AS "endsOn", leave_type AS "leaveType", status
     FROM employee_leave_requests
     WHERE company_id = $1
       AND candidate_id = $2
       AND status IN ('requested', 'approved', 'taken')
       AND ends_on >= $3::date
       AND starts_on <= $4::date
       ${exclude}
     ORDER BY starts_on ASC
     LIMIT 1`,
    params
  );
  return r.rowCount ? r.rows[0] : null;
}

async function assertEmployeeCandidate(db, companyId, candidateId) {
  const res = await db.query(
    `SELECT id, company_id AS "companyId",
            employment_status AS "employmentStatus",
            full_name AS "fullName", email
     FROM candidates
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [candidateId, companyId]
  );
  if (!res.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const row = res.rows[0];
  if (
    row.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE &&
    row.employmentStatus !== EMPLOYMENT_STATUS.ALUMNI
  ) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }
  return { ok: true, candidate: row };
}

/** Display name for notifications (tenant-scoped). */
export async function getEmployeeDisplayName(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const gate = await assertEmployeeCandidate(db, Number(companyId), Number(candidateId));
  if (!gate.ok) return '';
  return gate.candidate.fullName || '';
}

/** Seed default document checklist rows (idempotent). */
export async function ensureDpDocuments(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(candId)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: true, skipped: true };
  }

  for (const key of DP_DOCUMENT_KEYS) {
    if (key === DP_DOCUMENT_KEY.OTHER) continue;
    await db.query(
      `INSERT INTO employee_dp_documents (company_id, candidate_id, doc_key, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, doc_key) DO NOTHING`,
      [cid, candId, key, DP_DOCUMENT_STATUS.PENDING]
    );
  }
  return { ok: true };
}

export async function getDpProfile(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;

  const res = await db.query(
    `SELECT candidate_id AS "candidateId", company_id AS "companyId",
            emergency_name AS "emergencyName",
            emergency_phone AS "emergencyPhone",
            emergency_relation AS "emergencyRelation",
            cpf,
            rg,
            dependents,
            address_line AS "addressLine",
            address_number AS "addressNumber",
            address_city AS "addressCity",
            address_state AS "addressState",
            address_postal AS "addressPostal",
            internal_notes AS "internalNotes",
            updated_at AS "updatedAt"
     FROM candidate_dp_profiles
     WHERE candidate_id = $1 AND company_id = $2
     LIMIT 1`,
    [candId, cid]
  );
  return {
    ok: true,
    profile: res.rowCount ? mapProfile(res.rows[0]) : emptyProfile(candId, cid),
  };
}

export async function upsertDpProfile(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI && !input.allowAlumni) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const validCpf = value => value == null || value === '' || /^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(String(value).trim());
  if (input.emergencyPhone != null && String(input.emergencyPhone).trim()) {
    const rawPhone = String(input.emergencyPhone).trim();
    const digits = rawPhone.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]+$/.test(rawPhone) || digits.length < 10 || digits.length > 15) return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const validDependentDate = value => {
    if (value == null || value === '') return true;
    const s = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000-')) return false;
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  };
  if (!validCpf(input.cpf) || (input.dependents !== undefined && (!Array.isArray(input.dependents) || input.dependents.length > 20 || input.dependents.some(item => !item || typeof item !== 'object' || !validCpf(item.cpf) || !validDependentDate(item.birthDate))))) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const emergencyName = clip(input.emergencyName, 120);
  const emergencyPhone = stripPhone(input.emergencyPhone) || '';
  const emergencyRelation = normalizeEmergencyRelation(input.emergencyRelation);
  const cpf = stripCpf(input.cpf) || '';
  const rg = clip(input.rg, 40);
  const dependents = JSON.stringify(normalizeDependents(input.dependents));
  const addressLine = clip(input.addressLine, 240);
  const hasAddressNumber = input.addressNumber !== undefined;
  if (hasAddressNumber && input.addressNumber !== null &&
      (typeof input.addressNumber !== 'string' || input.addressNumber.trim().length > DP_ADDRESS_NUMBER_MAX_LENGTH)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const addressNumber = clip(input.addressNumber, DP_ADDRESS_NUMBER_MAX_LENGTH);
  const addressCity = clip(input.addressCity, 120);
  const addressState = clip(input.addressState, 2).toUpperCase();
  const addressPostal = stripCep(input.addressPostal) || '';
  const internalNotes = clip(input.internalNotes, 4000);
  const userId = input.userId != null ? Number(input.userId) : null;

  const before = await db.query(
    `SELECT emergency_name AS "emergencyName", emergency_phone AS "emergencyPhone",
            emergency_relation AS "emergencyRelation", cpf, rg, dependents,
            address_line AS "addressLine", address_number AS "addressNumber",
            address_city AS "addressCity", address_state AS "addressState",
            address_postal AS "addressPostal", internal_notes AS "internalNotes"
     FROM candidate_dp_profiles WHERE candidate_id = $1 AND company_id = $2`,
    [candId, cid]
  );

  const res = await db.query(
    `INSERT INTO candidate_dp_profiles (
       candidate_id, company_id,
       emergency_name, emergency_phone, emergency_relation, cpf, rg, dependents,
       address_line, address_city, address_state, address_postal,
       internal_notes, updated_by_user_id, address_number, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (candidate_id) DO UPDATE SET
       emergency_name = CASE WHEN 'emergencyName' = ANY($17::text[]) THEN EXCLUDED.emergency_name ELSE candidate_dp_profiles.emergency_name END,
       emergency_phone = CASE WHEN 'emergencyPhone' = ANY($17::text[]) THEN EXCLUDED.emergency_phone ELSE candidate_dp_profiles.emergency_phone END,
       emergency_relation = CASE WHEN 'emergencyRelation' = ANY($17::text[]) THEN EXCLUDED.emergency_relation ELSE candidate_dp_profiles.emergency_relation END,
       cpf = CASE WHEN 'cpf' = ANY($17::text[]) THEN EXCLUDED.cpf ELSE candidate_dp_profiles.cpf END,
       rg = CASE WHEN 'rg' = ANY($17::text[]) THEN EXCLUDED.rg ELSE candidate_dp_profiles.rg END,
       dependents = CASE WHEN 'dependents' = ANY($17::text[]) THEN EXCLUDED.dependents ELSE candidate_dp_profiles.dependents END,
       address_line = CASE WHEN 'addressLine' = ANY($17::text[]) THEN EXCLUDED.address_line ELSE candidate_dp_profiles.address_line END,
       address_number = CASE WHEN $16::boolean THEN EXCLUDED.address_number ELSE candidate_dp_profiles.address_number END,
       address_city = CASE WHEN 'addressCity' = ANY($17::text[]) THEN EXCLUDED.address_city ELSE candidate_dp_profiles.address_city END,
       address_state = CASE WHEN 'addressState' = ANY($17::text[]) THEN EXCLUDED.address_state ELSE candidate_dp_profiles.address_state END,
       address_postal = CASE WHEN 'addressPostal' = ANY($17::text[]) THEN EXCLUDED.address_postal ELSE candidate_dp_profiles.address_postal END,
       internal_notes = CASE WHEN 'internalNotes' = ANY($17::text[]) THEN EXCLUDED.internal_notes ELSE candidate_dp_profiles.internal_notes END,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = NOW()
     RETURNING candidate_id AS "candidateId", company_id AS "companyId",
               emergency_name AS "emergencyName",
               emergency_phone AS "emergencyPhone",
               emergency_relation AS "emergencyRelation",
               cpf,
               rg,
               dependents,
               address_line AS "addressLine",
               address_number AS "addressNumber",
               address_city AS "addressCity",
               address_state AS "addressState",
               address_postal AS "addressPostal",
               internal_notes AS "internalNotes",
               updated_at AS "updatedAt"`,
    [
      candId,
      cid,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
      cpf,
      rg,
      dependents,
      addressLine,
      addressCity,
      addressState,
      addressPostal,
      internalNotes,
      Number.isFinite(userId) ? userId : null,
      addressNumber,
      hasAddressNumber,
      Object.keys(input).filter(key => input[key] !== undefined),
    ]
  );
  const changes = diffAuditFields(before.rows[0] || null, res.rows[0], { presenceFields: DP_AUDIT_PRESENCE_FIELDS });
  return { ok: true, profile: mapProfile(res.rows[0]), changes };
}

export async function listDpDocuments(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;

  await ensureDpDocuments(db, { companyId: cid, candidateId: candId });

  const res = await db.query(
    `SELECT ${DOC_SELECT}
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2
     ORDER BY doc_key ASC`,
    [cid, candId]
  );
  return { ok: true, items: res.rows.map(mapDoc) };
}

export async function updateDpDocument(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const docKey = String(input.docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(docKey)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  await ensureDpDocuments(db, { companyId: cid, candidateId: candId });

  const sets = [];
  const params = [];
  if (input.status != null) {
    const status = String(input.status);
    if (!DP_DOCUMENT_STATUSES.includes(status)) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
  }
  if (input.notes != null) {
    params.push(clip(input.notes, 2000));
    sets.push(`notes = $${params.length}`);
  }
  if (!sets.length) return { ok: false, errorCode: ERR.INVALID_DATA };

  sets.push('updated_at = NOW()');
  if (input.userId != null) {
    params.push(Number(input.userId));
    sets.push(`updated_by_user_id = $${params.length}`);
  }
  params.push(cid, candId, docKey);

  const res = await db.query(
    `UPDATE employee_dp_documents
     SET ${sets.join(', ')}
     WHERE company_id = $${params.length - 2}
       AND candidate_id = $${params.length - 1}
       AND doc_key = $${params.length}
     RETURNING ${DOC_SELECT}`,
    params
  );
  if (!res.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  return { ok: true, item: mapDoc(res.rows[0]) };
}

export function assertValidDpDocumentFile(file = {}) {
  const size = Number(file.size);
  const buf = file.buffer;
  const bufLen = Buffer.isBuffer(buf) ? buf.length : size;
  if (!Number.isFinite(bufLen) || bufLen <= 0 || bufLen > DP_DOC_MAX_BYTES) {
    const err = new Error(ERR.DP_FILE_SIZE);
    err.code = ERR.DP_FILE_SIZE;
    throw err;
  }
  let mime = 'application/pdf';
  if (Buffer.isBuffer(buf)) {
    if (isPdfBuffer(buf)) mime = 'application/pdf';
    else {
      const img = detectImageMimeFromBuffer(buf);
      if (img === 'image/jpeg' || img === 'image/png') mime = img;
      else {
        const err = new Error(ERR.DP_FILE_TYPE);
        err.code = ERR.DP_FILE_TYPE;
        throw err;
      }
    }
  } else {
    const declared = String(file.mimeType || '')
      .toLowerCase()
      .split(';')[0]
      .trim();
    if (!DP_DOC_ALLOWED_MIMES.includes(declared)) {
      const err = new Error(ERR.DP_FILE_TYPE);
      err.code = ERR.DP_FILE_TYPE;
      throw err;
    }
    mime = declared;
  }
  return { mimeType: mime };
}

export async function uploadDpDocumentFile(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  if (!isObjectStorageConfigured()) {
    return { ok: false, errorCode: ERR.STORAGE_NOT_CONFIGURED };
  }
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const docKey = String(input.docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(docKey)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  await ensureDpDocuments(db, { companyId: cid, candidateId: candId });

  const { mimeType } = assertValidDpDocumentFile(input.file);
  const ext =
    mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'pdf';
  const opaque = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const objectKey = companyScopedObjectKey(cid, `dp-docs/${candId}/${docKey}/${opaque}`);

  const existing = await db.query(
    `SELECT file_key AS "fileKey", signature_status AS "signatureStatus"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3`,
    [cid, candId, docKey]
  );
  const prevKey = existing.rows[0]?.fileKey || null;
  if (existing.rows[0]?.signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_LOCKED };
  }

  const put = await putObject({
    key: objectKey,
    body: input.file.buffer,
    contentType: mimeType,
    cacheControl: 'private, no-store',
  });
  if (!put?.url) return { ok: false, errorCode: ERR.INTERNAL };

  const fileName = clip(input.file.originalName || opaque, 200);
  const res = await db.query(
    `UPDATE employee_dp_documents
     SET file_url = $1, file_key = $2, file_name = $3,
         status = CASE WHEN status = 'waived' THEN status ELSE 'received' END,
         signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.NONE}',
         signature_requested_at = NULL,
         signature_requested_by_user_id = NULL,
         signed_at = NULL,
         signer_name = '',
         signer_ip = NULL,
         signer_user_agent = NULL,
         signature_consent_version = '',
         signature_file_key = NULL,
         signer_stroke_png = '',
         updated_at = NOW(),
         updated_by_user_id = $4
     WHERE company_id = $5 AND candidate_id = $6 AND doc_key = $7
       AND signature_status <> '${DP_DOCUMENT_SIGNATURE_STATUS.SIGNED}'
       AND file_key IS NOT DISTINCT FROM $8
     RETURNING ${DOC_SELECT}`,
    [
      put.url,
      objectKey,
      fileName,
      input.userId != null ? Number(input.userId) : null,
      cid,
      candId,
      docKey,
      prevKey,
    ]
  );
  // Compare-and-swap: a signature or replacement during storage upload wins.
  // The rejected object was never associated with the document.
  if (!res.rowCount) {
    await deleteObjectBestEffort(objectKey);
    const current = await db.query(
      `SELECT signature_status AS "signatureStatus" FROM employee_dp_documents
       WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3`,
      [cid, candId, docKey]
    );
    return { ok: false, errorCode: current.rows[0]?.signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED
      ? ERR.DP_SIGNATURE_LOCKED : ERR.INVALID_ACTION };
  }
  if (prevKey && prevKey !== objectKey) {
    await deleteObjectBestEffort(prevKey);
  }
  return { ok: true, item: mapDoc(res.rows[0]) };
}

export async function downloadDpDocumentFile(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const docKey = String(input.docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(docKey)) return { ok: false, errorCode: ERR.INVALID_DATA };
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  const result = await db.query(
    `SELECT file_key AS "fileKey", file_name AS "fileName"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3
     LIMIT 1`,
    [cid, candId, docKey]
  );
  const row = result.rows[0];
  if (!row?.fileKey) return { ok: false, errorCode: ERR.NOT_FOUND };
  const expectedPrefix = companyScopedObjectKey(cid, `dp-docs/${candId}/${docKey}`);
  if (!String(row.fileKey).startsWith(`${expectedPrefix}/`)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const object = await getObjectBytes(row.fileKey);
  return {
    ok: true,
    body: object.body,
    contentType: object.contentType,
    fileName: clip(row.fileName || `${docKey}.bin`, 200),
  };
}

export async function clearDpDocumentFile(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const docKey = String(input.docKey || '');
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;

  const existing = await db.query(
    `SELECT file_key AS "fileKey", signature_status AS "signatureStatus"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3`,
    [cid, candId, docKey]
  );
  if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (existing.rows[0].signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_LOCKED };
  }
  const prevKey = existing.rows[0].fileKey;

  const res = await db.query(
    `UPDATE employee_dp_documents
     SET file_url = NULL, file_key = NULL, file_name = '',
         signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.NONE}',
         signature_requested_at = NULL,
         signature_requested_by_user_id = NULL,
         signed_at = NULL,
         signer_name = '',
         signer_ip = NULL,
         signer_user_agent = NULL,
         signature_consent_version = '',
         signature_file_key = NULL,
         signer_stroke_png = '',
         updated_at = NOW(),
         updated_by_user_id = $1
     WHERE company_id = $2 AND candidate_id = $3 AND doc_key = $4
     RETURNING ${DOC_SELECT}`,
    [input.userId != null ? Number(input.userId) : null, cid, candId, docKey]
  );
  if (prevKey) await deleteObjectBestEffort(prevKey);
  return { ok: true, item: mapDoc(res.rows[0]) };
}

/**
 * RH requests canvas + typed-name acknowledgment on an attached admission document.
 * Not ICP-Brasil / partner e-sign.
 */
export async function requestDpDocumentSignature(dbOrQuery, {
  companyId,
  candidateId,
  docKey,
  requestedByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  const key = String(docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(key)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const cur = await db.query(
    `SELECT file_key AS "fileKey", signature_status AS "signatureStatus"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3
     LIMIT 1`,
    [cid, candId, key]
  );
  if (!cur.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!cur.rows[0].fileKey) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_NO_FILE };
  }
  if (cur.rows[0].signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_LOCKED };
  }

  const res = await db.query(
    `UPDATE employee_dp_documents
     SET signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED}',
         signature_requested_at = NOW(),
         signature_requested_by_user_id = $1,
         signed_at = NULL,
         signer_name = '',
         signer_ip = NULL,
         signer_user_agent = NULL,
         signature_consent_version = '',
         signature_file_key = NULL,
         signer_stroke_png = '',
         updated_at = NOW(),
         updated_by_user_id = $1
     WHERE company_id = $2 AND candidate_id = $3 AND doc_key = $4
     RETURNING ${DOC_SELECT}`,
    [requestedByUserId != null ? Number(requestedByUserId) : null, cid, candId, key]
  );
  return { ok: true, item: mapDoc(res.rows[0]) };
}

/**
 * Collaborator acknowledges a requested document with typed name + drawn stroke + consent.
 */
export async function signDpDocument(dbOrQuery, {
  companyId,
  candidateId,
  docKey,
  signerName,
  consent = false,
  strokePng = '',
  signerIp = null,
  signerUserAgent = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  const key = String(docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(key)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  if (!consent) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_CONSENT_REQUIRED };
  }
  const name = clip(signerName, 120);
  if (name.length < 3) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_NAME_REQUIRED };
  }
  const stroke = String(strokePng || '').trim();
  if (!stroke.startsWith('data:image/png;base64,') || stroke.length < 64) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_STROKE_REQUIRED };
  }
  if (stroke.length > DP_SIGNATURE_STROKE_MAX_CHARS) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_STROKE_TOO_LARGE };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const cur = await db.query(
    `SELECT file_key AS "fileKey", signature_status AS "signatureStatus"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3
     LIMIT 1`,
    [cid, candId, key]
  );
  if (!cur.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (!cur.rows[0].fileKey) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_NO_FILE };
  }
  if (cur.rows[0].signatureStatus !== DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_NOT_REQUESTED };
  }

  const res = await db.query(
    `UPDATE employee_dp_documents
     SET signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.SIGNED}',
         signed_at = NOW(),
         signer_name = $1,
         signer_ip = $2,
         signer_user_agent = $3,
         signature_consent_version = $4,
         signature_file_key = file_key,
         signer_stroke_png = $5,
         status = CASE
           WHEN status = '${DP_DOCUMENT_STATUS.WAIVED}' THEN status
           ELSE '${DP_DOCUMENT_STATUS.RECEIVED}'
         END,
         updated_at = NOW()
     WHERE company_id = $6 AND candidate_id = $7 AND doc_key = $8
       AND signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED}'
     RETURNING ${DOC_SELECT}`,
    [
      name,
      clip(signerIp, 64) || null,
      clip(signerUserAgent, 300) || null,
      DP_SIGNATURE_CONSENT_VERSION,
      stroke,
      cid,
      candId,
      key,
    ]
  );
  if (!res.rowCount) return { ok: false, errorCode: ERR.DP_SIGNATURE_NOT_REQUESTED };
  return { ok: true, item: mapDoc(res.rows[0]) };
}

/**
 * RH waives signature requirement (or clears a request without signing).
 */
export async function waiveDpDocumentSignature(dbOrQuery, {
  companyId,
  candidateId,
  docKey,
  waivedByUserId = null,
}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  const key = String(docKey || '');
  if (!DP_DOCUMENT_KEYS.includes(key)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;

  const cur = await db.query(
    `SELECT signature_status AS "signatureStatus"
     FROM employee_dp_documents
     WHERE company_id = $1 AND candidate_id = $2 AND doc_key = $3
     LIMIT 1`,
    [cid, candId, key]
  );
  if (!cur.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (cur.rows[0].signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.SIGNED) {
    return { ok: false, errorCode: ERR.DP_SIGNATURE_LOCKED };
  }

  const res = await db.query(
    `UPDATE employee_dp_documents
     SET signature_status = '${DP_DOCUMENT_SIGNATURE_STATUS.WAIVED}',
         signature_requested_at = NULL,
         signature_requested_by_user_id = NULL,
         signed_at = NULL,
         signer_name = '',
         signer_ip = NULL,
         signer_user_agent = NULL,
         signature_consent_version = '',
         signature_file_key = NULL,
         signer_stroke_png = '',
         updated_at = NOW(),
         updated_by_user_id = $1
     WHERE company_id = $2 AND candidate_id = $3 AND doc_key = $4
     RETURNING ${DOC_SELECT}`,
    [waivedByUserId != null ? Number(waivedByUserId) : null, cid, candId, key]
  );
  return { ok: true, item: mapDoc(res.rows[0]) };
}

/**
 * Vacation saldo: entitlement + adjustment − used − pending (calendar days).
 * Usage is scoped to the aquisitivo window (period_start/period_end, or calendar year).
 * Missing row → default entitlement (30). Non-vacation types do not consume saldo.
 */
export async function getLeaveBalance(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const candId = Number(candidateId);
  if (!Number.isFinite(cid) || !Number.isFinite(candId)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;

  let entitlement = DP_LEAVE_DEFAULT_ENTITLEMENT_DAYS;
  let adjustment = 0;
  let notes = '';
  let updatedAt = null;
  let hasRow = false;
  let periodStartRaw = null;
  let periodEndRaw = null;

  try {
    const bal = await db.query(
      `SELECT entitlement_days AS "entitlementDays",
              adjustment_days AS "adjustmentDays",
              notes, updated_at AS "updatedAt",
              period_start AS "periodStart",
              period_end AS "periodEnd"
       FROM employee_leave_balances
       WHERE candidate_id = $1 AND company_id = $2
       LIMIT 1`,
      [candId, cid]
    );
    if (bal.rowCount > 0) {
      hasRow = true;
      entitlement = toDayNumber(bal.rows[0].entitlementDays);
      adjustment = toDayNumber(bal.rows[0].adjustmentDays);
      notes = bal.rows[0].notes || '';
      updatedAt = bal.rows[0].updatedAt || null;
      periodStartRaw = bal.rows[0].periodStart;
      periodEndRaw = bal.rows[0].periodEnd;
    }
  } catch (err) {
    if (err?.code === '42703') {
      const bal = await db.query(
        `SELECT entitlement_days AS "entitlementDays",
                adjustment_days AS "adjustmentDays",
                notes, updated_at AS "updatedAt"
         FROM employee_leave_balances
         WHERE candidate_id = $1 AND company_id = $2
         LIMIT 1`,
        [candId, cid]
      );
      if (bal.rowCount > 0) {
        hasRow = true;
        entitlement = toDayNumber(bal.rows[0].entitlementDays);
        adjustment = toDayNumber(bal.rows[0].adjustmentDays);
        notes = bal.rows[0].notes || '';
        updatedAt = bal.rows[0].updatedAt || null;
      }
    } else if (err?.code !== '42P01') throw err;
  }

  const period = resolveLeavePeriod(
    { periodStart: periodStartRaw, periodEnd: periodEndRaw },
    new Date()
  );

  let usedDays = 0;
  let pendingDays = 0;
  try {
    const usage = await db.query(
      `SELECT
         COALESCE(SUM((ends_on - starts_on) + 1) FILTER (
           WHERE status IN ('approved', 'taken')
         ), 0)::float AS "usedDays",
         COALESCE(SUM((ends_on - starts_on) + 1) FILTER (
           WHERE status = 'requested'
         ), 0)::float AS "pendingDays"
       FROM employee_leave_requests
       WHERE company_id = $1
         AND candidate_id = $2
         AND leave_type = $3
         AND starts_on >= $4::date
         AND starts_on <= $5::date`,
      [cid, candId, DP_LEAVE_TYPE.VACATION, period.periodStart, period.periodEnd]
    );
    usedDays = toDayNumber(usage.rows[0]?.usedDays);
    pendingDays = toDayNumber(usage.rows[0]?.pendingDays);
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  const pool = toDayNumber(entitlement + adjustment);
  const available = toDayNumber(pool - usedDays - pendingDays);

  return {
    ok: true,
    balance: {
      candidateId: candId,
      companyId: cid,
      entitlementDays: entitlement,
      adjustmentDays: adjustment,
      usedDays,
      pendingDays,
      availableDays: available,
      notes,
      updatedAt,
      hasRow,
      defaultEntitlement: !hasRow,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      customPeriod: period.customPeriod,
    },
  };
}

export async function upsertLeaveBalance(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus === EMPLOYMENT_STATUS.ALUMNI && !input.allowAlumni) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const entitlement =
    input.entitlementDays != null
      ? toDayNumber(input.entitlementDays)
      : DP_LEAVE_DEFAULT_ENTITLEMENT_DAYS;
  const adjustment = input.adjustmentDays != null ? toDayNumber(input.adjustmentDays) : 0;
  if (entitlement < 0 || entitlement > 365 || adjustment < -365 || adjustment > 365) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  let periodStart = null;
  let periodEnd = null;
  if (input.periodStart != null || input.periodEnd != null) {
    periodStart = dateOrNull(input.periodStart);
    periodEnd = dateOrNull(input.periodEnd);
    if (!periodStart || !periodEnd || periodEnd < periodStart) {
      return { ok: false, errorCode: ERR.INVALID_DATE };
    }
  } else if (input.clearPeriod === true) {
    periodStart = null;
    periodEnd = null;
  }

  try {
    if (input.periodStart != null || input.periodEnd != null || input.clearPeriod === true) {
      await db.query(
        `INSERT INTO employee_leave_balances (
           candidate_id, company_id, entitlement_days, adjustment_days, notes,
           period_start, period_end, updated_by_user_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, NOW())
         ON CONFLICT (candidate_id) DO UPDATE SET
           company_id = EXCLUDED.company_id,
           entitlement_days = EXCLUDED.entitlement_days,
           adjustment_days = EXCLUDED.adjustment_days,
           notes = EXCLUDED.notes,
           period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = NOW()`,
        [
          candId,
          cid,
          entitlement,
          adjustment,
          clip(input.notes, 1000),
          periodStart,
          periodEnd,
          input.userId != null ? Number(input.userId) : null,
        ]
      );
    } else {
      await db.query(
        `INSERT INTO employee_leave_balances (
           candidate_id, company_id, entitlement_days, adjustment_days, notes,
           updated_by_user_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (candidate_id) DO UPDATE SET
           company_id = EXCLUDED.company_id,
           entitlement_days = EXCLUDED.entitlement_days,
           adjustment_days = EXCLUDED.adjustment_days,
           notes = EXCLUDED.notes,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = NOW()`,
        [
          candId,
          cid,
          entitlement,
          adjustment,
          clip(input.notes, 1000),
          input.userId != null ? Number(input.userId) : null,
        ]
      );
    }
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, errorCode: ERR.SCHEMA_NOT_INITIALIZED };
    if (err?.code === '42703') {
      /* period columns missing — write without them */
      await db.query(
        `INSERT INTO employee_leave_balances (
           candidate_id, company_id, entitlement_days, adjustment_days, notes,
           updated_by_user_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (candidate_id) DO UPDATE SET
           company_id = EXCLUDED.company_id,
           entitlement_days = EXCLUDED.entitlement_days,
           adjustment_days = EXCLUDED.adjustment_days,
           notes = EXCLUDED.notes,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = NOW()`,
        [
          candId,
          cid,
          entitlement,
          adjustment,
          clip(input.notes, 1000),
          input.userId != null ? Number(input.userId) : null,
        ]
      );
    } else {
      throw err;
    }
  }

  return getLeaveBalance(db, { companyId: cid, candidateId: candId });
}

export async function createLeaveRequest(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  const leaveType = String(input.leaveType || '');
  if (!DP_LEAVE_TYPES.includes(leaveType)) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }
  const startsOn = dateOrNull(input.startsOn);
  const endsOn = dateOrNull(input.endsOn);
  if (!startsOn || !endsOn || endsOn < startsOn) {
    return { ok: false, errorCode: ERR.INVALID_DATE };
  }
  const gate = await assertEmployeeCandidate(db, cid, candId);
  if (!gate.ok) return gate;
  if (gate.candidate.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const overlap = await findLeaveOverlap(db, {
    companyId: cid,
    candidateId: candId,
    startsOn,
    endsOn,
  });
  if (overlap) {
    return {
      ok: false,
      errorCode: ERR.LEAVE_OVERLAP,
      overlap: {
        id: Number(overlap.id),
        startsOn: dateOrNull(overlap.startsOn),
        endsOn: dateOrNull(overlap.endsOn),
        leaveType: overlap.leaveType,
        status: overlap.status,
      },
    };
  }

  const dayCount = leaveInclusiveDays(startsOn, endsOn);
  if (leaveType === DP_LEAVE_TYPE.VACATION && !input.allowOverBalance) {
    const bal = await getLeaveBalance(db, { companyId: cid, candidateId: candId });
    if (!bal.ok) return bal;
    if (dayCount != null && dayCount > bal.balance.availableDays) {
      return {
        ok: false,
        errorCode: ERR.LEAVE_BALANCE_EXCEEDED,
        balance: bal.balance,
        requestedDays: dayCount,
      };
    }
  }

  const requestedBy = input.requestedBy === 'employee' ? 'employee' : 'manager';
  const status =
    requestedBy === 'manager' && input.autoApprove
      ? DP_LEAVE_STATUS.APPROVED
      : DP_LEAVE_STATUS.REQUESTED;

  const res = await db.query(
    `INSERT INTO employee_leave_requests (
       company_id, candidate_id, leave_type, status,
       starts_on, ends_on, reason, requested_by, created_by_user_id,
       decided_by_user_id, decided_at
     ) VALUES (
       $1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,
       $10, CASE WHEN $4 = 'approved' THEN NOW() ELSE NULL END
     )
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               leave_type AS "leaveType", status,
               starts_on AS "startsOn", ends_on AS "endsOn",
               reason, manager_notes AS "managerNotes",
               requested_by AS "requestedBy",
               decided_at AS "decidedAt", created_at AS "createdAt"`,
    [
      cid,
      candId,
      leaveType,
      status,
      startsOn,
      endsOn,
      sanitizeRichTextHtml(input.reason || '', DP_LEAVE_REASON_MAX) || '',
      requestedBy,
      input.userId != null ? Number(input.userId) : null,
      status === DP_LEAVE_STATUS.APPROVED && input.userId != null
        ? Number(input.userId)
        : null,
    ]
  );
  const item = mapLeave({
    ...res.rows[0],
    candidateName: gate.candidate.fullName,
    candidateEmail: gate.candidate.email,
  });
  return { ok: true, item, dayCount };
}

/**
 * Collaborator cancels own leave while still `requested`.
 */
export async function cancelEmployeeLeaveRequest(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const id = Number(input.id);
  const cid = Number(input.companyId);
  const candId = Number(input.candidateId);
  if (!Number.isFinite(id) || !Number.isFinite(cid) || !Number.isFinite(candId)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const existing = await db.query(
    `SELECT id, company_id AS "companyId", candidate_id AS "candidateId",
            leave_type AS "leaveType", status,
            starts_on AS "startsOn", ends_on AS "endsOn",
            reason, manager_notes AS "managerNotes",
            requested_by AS "requestedBy",
            decided_at AS "decidedAt", created_at AS "createdAt"
     FROM employee_leave_requests
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3
     LIMIT 1`,
    [id, cid, candId]
  );
  if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (existing.rows[0].status !== DP_LEAVE_STATUS.REQUESTED) {
    return { ok: false, errorCode: ERR.LEAVE_NOT_CANCELLABLE };
  }

  const res = await db.query(
    `UPDATE employee_leave_requests
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3 AND candidate_id = $4
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               leave_type AS "leaveType", status,
               starts_on AS "startsOn", ends_on AS "endsOn",
               reason, manager_notes AS "managerNotes",
               requested_by AS "requestedBy",
               decided_at AS "decidedAt", created_at AS "createdAt"`,
    [DP_LEAVE_STATUS.CANCELLED, id, cid, candId]
  );
  return { ok: true, item: mapLeave(res.rows[0]) };
}

export async function uploadLeaveAttachment(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  if (!isObjectStorageConfigured()) {
    return { ok: false, errorCode: ERR.STORAGE_NOT_CONFIGURED };
  }
  const id = Number(input.id);
  const cid = Number(input.companyId);
  if (!Number.isFinite(id) || !Number.isFinite(cid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const existing = await db.query(
    `SELECT id, candidate_id AS "candidateId", leave_type AS "leaveType", status,
            file_key AS "fileKey"
     FROM employee_leave_requests
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [id, cid]
  );
  if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cur = existing.rows[0];
  if (input.candidateId != null && Number(cur.candidateId) !== Number(input.candidateId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  if (cur.leaveType !== DP_LEAVE_TYPE.SICK) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }
  if (
    cur.status === DP_LEAVE_STATUS.CANCELLED ||
    cur.status === DP_LEAVE_STATUS.REJECTED
  ) {
    return { ok: false, errorCode: ERR.INVALID_ACTION };
  }

  const { mimeType } = assertValidDpDocumentFile(input.file);
  const ext =
    mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'pdf';
  const opaque = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const objectKey = companyScopedObjectKey(
    cid,
    `dp-leave/${cur.candidateId}/${id}/${opaque}`
  );
  const prevKey = cur.fileKey || null;

  const put = await putObject({
    key: objectKey,
    body: input.file.buffer,
    contentType: mimeType,
    cacheControl: 'private, no-store',
  });
  if (!put?.url) return { ok: false, errorCode: ERR.INTERNAL };

  const fileName = clip(input.file.originalName || opaque, 200);
  const res = await db.query(
    `UPDATE employee_leave_requests
     SET file_url = $1, file_key = $2, file_name = $3, updated_at = NOW()
     WHERE id = $4 AND company_id = $5
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               leave_type AS "leaveType", status,
               starts_on AS "startsOn", ends_on AS "endsOn",
               reason, manager_notes AS "managerNotes",
               requested_by AS "requestedBy",
               decided_at AS "decidedAt", created_at AS "createdAt",
               file_url AS "fileUrl", file_key AS "fileKey", file_name AS "fileName"`,
    [put.url, objectKey, fileName, id, cid]
  );
  if (prevKey && prevKey !== objectKey) {
    await deleteObjectBestEffort(prevKey);
  }
  return { ok: true, item: mapLeave(res.rows[0]) };
}

export async function downloadLeaveAttachment(dbOrQuery, { id, companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const gate = await assertEmployeeCandidate(db, Number(companyId), Number(candidateId));
  if (!gate.ok) return gate;
  const result = await db.query(
    `SELECT file_key AS "fileKey", file_name AS "fileName" FROM employee_leave_requests
     WHERE id = $1 AND company_id = $2 AND candidate_id = $3 LIMIT 1`,
    [id, companyId, candidateId]
  );
  const row = result.rows[0];
  const prefix = companyScopedObjectKey(companyId, `dp-leave/${candidateId}/${id}`);
  if (!row?.fileKey || !String(row.fileKey).startsWith(`${prefix}/`)) return { ok: false, errorCode: ERR.NOT_FOUND };
  const object = await getObjectBytes(row.fileKey);
  return { ok: true, body: object.body, contentType: object.contentType, fileName: clip(row.fileName || 'attachment.bin', 200) };
}

export async function clearLeaveAttachment(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const id = Number(input.id);
  const cid = Number(input.companyId);
  if (!Number.isFinite(id) || !Number.isFinite(cid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const existing = await db.query(
    `SELECT id, candidate_id AS "candidateId", file_key AS "fileKey"
     FROM employee_leave_requests
     WHERE id = $1 AND company_id = $2
     LIMIT 1`,
    [id, cid]
  );
  if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  if (input.candidateId != null && Number(existing.rows[0].candidateId) !== Number(input.candidateId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  const prevKey = existing.rows[0].fileKey;

  const res = await db.query(
    `UPDATE employee_leave_requests
     SET file_url = NULL, file_key = NULL, file_name = '', updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               leave_type AS "leaveType", status,
               starts_on AS "startsOn", ends_on AS "endsOn",
               reason, manager_notes AS "managerNotes",
               requested_by AS "requestedBy",
               decided_at AS "decidedAt", created_at AS "createdAt",
               file_url AS "fileUrl", file_key AS "fileKey", file_name AS "fileName"`,
    [id, cid]
  );
  if (prevKey) await deleteObjectBestEffort(prevKey);
  return { ok: true, item: mapLeave(res.rows[0]) };
}

function csvEscapeLeave(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build CSV string for leave export (capped). */
export function buildLeaveExportCsv(items) {
  const header = [
    'id',
    'candidate_name',
    'candidate_email',
    'leave_type',
    'status',
    'starts_on',
    'ends_on',
    'days',
    'reason',
    'manager_notes',
    'requested_by',
    'has_file',
    'created_at',
  ];
  const lines = [header.join(',')];
  for (const row of items || []) {
    const days = leaveInclusiveDays(row.startsOn, row.endsOn);
    lines.push(
      [
        csvEscapeLeave(row.id),
        csvEscapeLeave(row.candidateName),
        csvEscapeLeave(row.candidateEmail),
        csvEscapeLeave(row.leaveType),
        csvEscapeLeave(row.status),
        csvEscapeLeave(row.startsOn),
        csvEscapeLeave(row.endsOn),
        csvEscapeLeave(days ?? ''),
        csvEscapeLeave(row.reason),
        csvEscapeLeave(row.managerNotes),
        csvEscapeLeave(row.requestedBy),
        csvEscapeLeave(row.hasFile ? '1' : '0'),
        csvEscapeLeave(row.createdAt ? String(row.createdAt) : ''),
      ].join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

export const LEAVE_EXPORT_MAX_ROWS = 5000;

export async function exportLeaveRequestsCsv(dbOrQuery, opts) {
  const all = [];
  let page = 1;
  const pageSize = 50;
  let totalPages = 1;
  do {
    const chunk = await listLeaveRequests(dbOrQuery, {
      ...opts,
      page,
      pageSize,
    });
    all.push(...chunk.items);
    totalPages = chunk.totalPages;
    page += 1;
  } while (page <= totalPages && all.length < LEAVE_EXPORT_MAX_ROWS);

  const items = all.slice(0, LEAVE_EXPORT_MAX_ROWS);
  return {
    csv: buildLeaveExportCsv(items),
    count: items.length,
    truncated: all.length >= LEAVE_EXPORT_MAX_ROWS && page <= totalPages,
  };
}

export async function updateLeaveRequest(dbOrQuery, input) {
  const db = asDb(dbOrQuery);
  const id = Number(input.id);
  const cid = Number(input.companyId);
  if (!Number.isFinite(id) || !Number.isFinite(cid)) {
    return { ok: false, errorCode: ERR.INVALID_ID };
  }

  const existing = await db.query(
    `SELECT id, company_id AS "companyId", candidate_id AS "candidateId", status
     FROM employee_leave_requests WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [id, cid]
  );
  if (!existing.rowCount) return { ok: false, errorCode: ERR.NOT_FOUND };
  const cur = existing.rows[0];

  const sets = [];
  const params = [];
  if (input.status != null) {
    const status = String(input.status);
    if (!DP_LEAVE_STATUSES.includes(status)) {
      return { ok: false, errorCode: ERR.INVALID_DATA };
    }
    params.push(status);
    sets.push(`status = $${params.length}`);
    if (
      status === DP_LEAVE_STATUS.APPROVED ||
      status === DP_LEAVE_STATUS.REJECTED ||
      status === DP_LEAVE_STATUS.TAKEN
    ) {
      params.push(input.userId != null ? Number(input.userId) : null);
      sets.push(`decided_by_user_id = $${params.length}`);
      sets.push('decided_at = NOW()');
    }
  }
  if (input.managerNotes != null) {
    params.push(clip(input.managerNotes, 2000));
    sets.push(`manager_notes = $${params.length}`);
  }
  if (input.reason != null && cur.status === DP_LEAVE_STATUS.REQUESTED) {
    params.push(sanitizeRichTextHtml(input.reason || '', DP_LEAVE_REASON_MAX) || '');
    sets.push(`reason = $${params.length}`);
  }
  if (!sets.length) return { ok: false, errorCode: ERR.INVALID_DATA };
  sets.push('updated_at = NOW()');
  params.push(id, cid);

  const res = await db.query(
    `UPDATE employee_leave_requests
     SET ${sets.join(', ')}
     WHERE id = $${params.length - 1} AND company_id = $${params.length}
     RETURNING id, company_id AS "companyId", candidate_id AS "candidateId",
               leave_type AS "leaveType", status,
               starts_on AS "startsOn", ends_on AS "endsOn",
               reason, manager_notes AS "managerNotes",
               requested_by AS "requestedBy",
               decided_at AS "decidedAt", created_at AS "createdAt"`,
    params
  );
  return { ok: true, item: mapLeave(res.rows[0]) };
}

export function parseLeaveListParams(searchParams) {
  const get = (k, d = '') =>
    typeof searchParams?.get === 'function'
      ? (searchParams.get(k) || d).toString()
      : String(searchParams?.[k] ?? d);

  const pageRaw = parseInt(get('page', '1'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const sizeRaw = parseInt(get('pageSize', '20'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(sizeRaw) ? sizeRaw : 20;
  const statusRaw = get('status', 'all').toLowerCase();
  const status = ['all', ...DP_LEAVE_STATUSES].includes(statusRaw) ? statusRaw : 'all';
  const typeRaw = get('leaveType', 'all').toLowerCase();
  const leaveType = ['all', ...DP_LEAVE_TYPES].includes(typeRaw) ? typeRaw : 'all';
  const q = get('q', '').trim().slice(0, 120);
  const from = dateOrNull(get('from', ''));
  const to = dateOrNull(get('to', ''));
  return { page, pageSize, status, leaveType, q, from, to };
}

export async function listLeaveRequests(dbOrQuery, opts) {
  const db = asDb(dbOrQuery);
  const cid = Number(opts.companyId);
  const { page, pageSize, status, leaveType, q, from, to } = parseLeaveListParams(opts);
  const params = [cid];
  let where = 'l.company_id = $1';

  if (opts.candidateId != null) {
    params.push(Number(opts.candidateId));
    where += ` AND l.candidate_id = $${params.length}`;
  }
  if (status !== 'all') {
    params.push(status);
    where += ` AND l.status = $${params.length}`;
  }
  if (leaveType !== 'all') {
    params.push(leaveType);
    where += ` AND l.leave_type = $${params.length}`;
  }
  if (from) {
    params.push(from);
    where += ` AND l.ends_on >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    where += ` AND l.starts_on <= $${params.length}::date`;
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where += ` AND (
      LOWER(COALESCE(c.full_name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(c.email, '')) LIKE $${params.length}
      OR LOWER(l.reason) LIKE $${params.length}
    )`;
  }

  const cnt = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM employee_leave_requests l
     JOIN candidates c ON c.id = l.candidate_id AND c.company_id = l.company_id
     WHERE ${where}`,
    params
  );
  const total = cnt.rows[0]?.n || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  params.push(pageSize, (safePage - 1) * pageSize);

  const list = await db.query(
    `SELECT l.id, l.company_id AS "companyId", l.candidate_id AS "candidateId",
            l.leave_type AS "leaveType", l.status,
            l.starts_on AS "startsOn", l.ends_on AS "endsOn",
            l.reason, l.manager_notes AS "managerNotes",
            l.requested_by AS "requestedBy",
            l.decided_at AS "decidedAt", l.created_at AS "createdAt",
            l.file_url AS "fileUrl", l.file_key AS "fileKey", l.file_name AS "fileName",
            c.full_name AS "candidateName", c.email AS "candidateEmail"
     FROM employee_leave_requests l
     JOIN candidates c ON c.id = l.candidate_id AND c.company_id = l.company_id
     WHERE ${where}
     ORDER BY l.starts_on DESC, l.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    items: list.rows.map(mapLeave),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/** Calendar window: approved/taken/requested overlapping [from, to]. */
export async function listLeaveCalendar(dbOrQuery, { companyId, from, to, limit = 200 }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const fromDate = dateOrNull(from) || new Date().toISOString().slice(0, 10);
  const toDate =
    dateOrNull(to) ||
    new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);

  const res = await db.query(
    `SELECT l.id, l.company_id AS "companyId", l.candidate_id AS "candidateId",
            l.leave_type AS "leaveType", l.status,
            l.starts_on AS "startsOn", l.ends_on AS "endsOn",
            l.reason, l.manager_notes AS "managerNotes",
            l.requested_by AS "requestedBy",
            l.decided_at AS "decidedAt", l.created_at AS "createdAt",
            l.file_url AS "fileUrl", l.file_key AS "fileKey", l.file_name AS "fileName",
            c.full_name AS "candidateName", c.email AS "candidateEmail"
     FROM employee_leave_requests l
     JOIN candidates c ON c.id = l.candidate_id AND c.company_id = l.company_id
     WHERE l.company_id = $1
       AND l.status IN ('requested', 'approved', 'taken')
       AND l.ends_on >= $2::date
       AND l.starts_on <= $3::date
     ORDER BY l.starts_on ASC, l.id ASC
     LIMIT $4`,
    [cid, fromDate, toDate, cap]
  );
  const items = res.rows.map(mapLeave);
  return {
    items,
    from: fromDate,
    to: toDate,
    byDay: expandLeaveCalendarByDay(items, fromDate, toDate),
  };
}

/** Overview / pulse: pending docs + leave needing attention. */
export async function getDpAttentionPulse(dbOrQuery, { companyId, cap = 8 }) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  const lim = Math.min(Math.max(Number(cap) || 8, 1), 20);
  const today = new Date().toISOString().slice(0, 10);

  const docs = await db.query(
    `SELECT d.candidate_id AS "candidateId",
            c.full_name AS "candidateName",
            COUNT(*) FILTER (WHERE d.status = 'pending')::int AS pending
     FROM employee_dp_documents d
     JOIN candidates c ON c.id = d.candidate_id AND c.company_id = d.company_id
     WHERE d.company_id = $1
       AND c.employment_status = $2
       AND d.status = 'pending'
     GROUP BY d.candidate_id, c.full_name
     HAVING COUNT(*) FILTER (WHERE d.status = 'pending') > 0
     ORDER BY pending DESC, c.full_name ASC
     LIMIT $3`,
    [cid, EMPLOYMENT_STATUS.EMPLOYEE, lim]
  );

  const leaves = await db.query(
    `SELECT l.id, l.candidate_id AS "candidateId",
            l.leave_type AS "leaveType", l.status,
            l.starts_on AS "startsOn", l.ends_on AS "endsOn",
            c.full_name AS "candidateName"
     FROM employee_leave_requests l
     JOIN candidates c ON c.id = l.candidate_id AND c.company_id = l.company_id
     WHERE l.company_id = $1
       AND (
         l.status = 'requested'
         OR (l.status IN ('approved', 'taken') AND l.starts_on <= ($2::date + 14)
             AND l.ends_on >= $2::date)
       )
     ORDER BY
       CASE WHEN l.status = 'requested' THEN 0 ELSE 1 END,
       l.starts_on ASC
     LIMIT $3`,
    [cid, today, lim]
  );

  return {
    pendingDocs: docs.rows.map((r) => ({
      candidateId: Number(r.candidateId),
      candidateName: r.candidateName,
      pending: Number(r.pending),
    })),
    leaves: leaves.rows.map((r) => ({
      id: Number(r.id),
      candidateId: Number(r.candidateId),
      candidateName: r.candidateName,
      leaveType: r.leaveType,
      status: r.status,
      startsOn: dateOrNull(r.startsOn),
      endsOn: dateOrNull(r.endsOn),
    })),
  };
}

const ABSENTEEISM_LOOKBACK_DAYS = 90;
/** Elevated when ≥2 sick leaves or ≥5 calendar days of sick leave in the window. */
const ABSENTEEISM_LEAVE_COUNT_MIN = 2;
const ABSENTEEISM_DAY_SUM_MIN = 5;

/**
 * Overview pulse: employees with elevated sick leave (approved/taken) in the last N days.
 * Vacation is planned leave — not counted as absenteeism.
 */
export async function getAbsenteeismPulse(dbOrQuery, {
  companyId,
  lookbackDays = ABSENTEEISM_LOOKBACK_DAYS,
  cap = 8,
} = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { items: [], lookbackDays: ABSENTEEISM_LOOKBACK_DAYS };
  }
  const days = Math.min(Math.max(Number(lookbackDays) || ABSENTEEISM_LOOKBACK_DAYS, 14), 180);
  const lim = Math.min(Math.max(Number(cap) || 8, 1), 20);
  const today = new Date().toISOString().slice(0, 10);

  const r = await db.query(
    `SELECT l.candidate_id AS "candidateId",
            c.full_name AS "candidateName",
            COUNT(*)::int AS "leaveCount",
            COALESCE(SUM((l.ends_on - l.starts_on) + 1), 0)::int AS "daySum"
     FROM employee_leave_requests l
     JOIN candidates c ON c.id = l.candidate_id AND c.company_id = l.company_id
     WHERE l.company_id = $1
       AND c.employment_status = $2
       AND l.leave_type = $3
       AND l.status IN ('approved', 'taken')
       AND l.ends_on >= ($4::date - $5::int)
       AND l.starts_on <= $4::date
     GROUP BY l.candidate_id, c.full_name
     HAVING COUNT(*) >= $6
         OR COALESCE(SUM((l.ends_on - l.starts_on) + 1), 0) >= $7
     ORDER BY "daySum" DESC, "leaveCount" DESC, c.full_name ASC
     LIMIT $8`,
    [
      cid,
      EMPLOYMENT_STATUS.EMPLOYEE,
      DP_LEAVE_TYPE.SICK,
      today,
      days,
      ABSENTEEISM_LEAVE_COUNT_MIN,
      ABSENTEEISM_DAY_SUM_MIN,
      lim,
    ]
  );

  return {
    items: (r.rows || []).map((row) => ({
      candidateId: Number(row.candidateId),
      candidateName: row.candidateName,
      leaveCount: Number(row.leaveCount) || 0,
      daySum: Number(row.daySum) || 0,
    })),
    lookbackDays: days,
  };
}

export async function getEmployeeDpHome(dbOrQuery, { companyId, candidateId }) {
  const db = asDb(dbOrQuery);
  const profile = await getDpProfile(db, { companyId, candidateId });
  if (!profile.ok) return profile;
  const docs = await listDpDocuments(db, { companyId, candidateId });
  if (!docs.ok) return docs;
  const leaves = await listLeaveRequests(db, {
    companyId,
    candidateId,
    page: 1,
    pageSize: 20,
    status: 'all',
  });
  // listLeaveRequests returns pagination/items without an ok flag; SQL failures throw.
  const balanceRes = await getLeaveBalance(db, { companyId, candidateId });
  const leaveItems = Array.isArray(leaves.items) ? leaves.items : [];
  const pendingDocs = docs.items.filter(
    (d) =>
      d.status === DP_DOCUMENT_STATUS.PENDING
      || d.signatureStatus === DP_DOCUMENT_SIGNATURE_STATUS.REQUESTED
  ).length;
  const openLeaves = leaveItems.filter(
    (l) =>
      l.status === DP_LEAVE_STATUS.REQUESTED ||
      l.status === DP_LEAVE_STATUS.APPROVED
  ).length;
  return {
    ok: true,
    profile: {
      ...profile.profile,
      fullName: await getEmployeeDisplayName(db, { companyId, candidateId }),
      internalNotes: undefined,
    },
    documents: docs.items.map((d) => ({
      ...d,
      notes: d.status === DP_DOCUMENT_STATUS.PENDING ? '' : d.notes,
    })),
    leaves: leaveItems,
    balance: balanceRes.ok
      ? {
          candidateId: balanceRes.balance.candidateId,
          companyId: balanceRes.balance.companyId,
          entitlementDays: balanceRes.balance.entitlementDays,
          adjustmentDays: balanceRes.balance.adjustmentDays,
          usedDays: balanceRes.balance.usedDays,
          pendingDays: balanceRes.balance.pendingDays,
          availableDays: balanceRes.balance.availableDays,
          defaultEntitlement: balanceRes.balance.defaultEntitlement,
          periodStart: balanceRes.balance.periodStart,
          periodEnd: balanceRes.balance.periodEnd,
          customPeriod: balanceRes.balance.customPeriod,
          // RH notes stay manager-only
        }
      : null,
    badge: pendingDocs + openLeaves,
    pendingDocs,
    openLeaves,
  };
}

/**
 * Cron: remind managers + collaborators about pending DP documents (dedupe per candidate+day).
 */
export async function notifyDpPendingDocuments(dbOrQuery, { limit = 200 } = {}) {
  const db = asDb(dbOrQuery);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const r = await db.query(
    `SELECT d.company_id AS "companyId",
            d.candidate_id AS "candidateId",
            c.full_name AS "candidateName",
            COUNT(*)::int AS pending
     FROM employee_dp_documents d
     JOIN candidates c ON c.id = d.candidate_id AND c.company_id = d.company_id
     WHERE d.status = $1
       AND c.employment_status = $2
     GROUP BY d.company_id, d.candidate_id, c.full_name
     HAVING COUNT(*) > 0
     ORDER BY pending DESC, c.full_name ASC
     LIMIT $3`,
    [DP_DOCUMENT_STATUS.PENDING, EMPLOYMENT_STATUS.EMPLOYEE, lim]
  );

  const { notifyCompanyManagers } = await import('../manager-notifications.js');
  const { NOTIF } = await import('../manager-notification-catalog.js');
  const { notifyCandidate, EMPLOYEE_NOTIF } = await import('../employee-notifications.js');

  let notified = 0;
  const today = new Date().toISOString().slice(0, 10);
  const rows = r.rows || [];
  const CHUNK = DB_FANOUT_CONCURRENCY;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (row) => {
        const dedupeKey = `dp_docs:${row.candidateId}:${today}`;
        await notifyCompanyManagers(db, {
          companyId: row.companyId,
          type: NOTIF.DP_DOCS_PENDING,
          entityType: 'candidate',
          entityId: row.candidateId,
          dedupeKey,
          payload: {
            candidateId: row.candidateId,
            candidateName: row.candidateName,
            pending: Number(row.pending),
          },
        });
        try {
          await notifyCandidate(db, {
            companyId: row.companyId,
            candidateId: row.candidateId,
            type: EMPLOYEE_NOTIF.DP_DOC_REMINDER,
            entityType: 'candidate',
            entityId: row.candidateId,
            dedupeKey,
            payload: { pending: Number(row.pending) },
          });
        } catch {
          /* schema may lag */
        }
      })
    );
    notified += slice.length;
  }
  return { scanned: r.rowCount, notified };
}

/** Cap for company vacation pool rollup (B-3029). */
export const VACATION_POOL_EMPLOYEE_CAP = 500;

/**
 * Company vacation pool: entitlement/used/pending/available (+ by job role).
 * Uses each person's aquisitivo window when set; otherwise calendar year.
 * Does not invent per-dossier charts.
 *
 * @returns {Promise<{ ok: true, pool: object } | { ok: false, errorCode }>}
 */
export async function getCompanyVacationPool(dbOrQuery, { companyId, limit = VACATION_POOL_EMPLOYEE_CAP } = {}) {
  const db = asDb(dbOrQuery);
  const cid = Number(companyId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { ok: false, errorCode: ERR.COMPANY_REQUIRED };
  }
  const cap = Math.min(
    VACATION_POOL_EMPLOYEE_CAP,
    Math.max(1, Number(limit) || VACATION_POOL_EMPLOYEE_CAP)
  );
  const ref = new Date();

  let employees;
  try {
    const empRes = await db.query(
      `SELECT c.id AS "candidateId",
              COALESCE(b.entitlement_days, $3)::float AS "entitlementDays",
              COALESCE(b.adjustment_days, 0)::float AS "adjustmentDays",
              b.period_start AS "periodStart",
              b.period_end AS "periodEnd",
              COALESCE(NULLIF(BTRIM(jr.name), ''), '') AS "jobRoleName"
       FROM candidates c
       LEFT JOIN employee_leave_balances b
         ON b.candidate_id = c.id AND b.company_id = c.company_id
       LEFT JOIN job_roles jr
         ON jr.id = c.job_role_id AND jr.company_id = c.company_id AND jr.active = TRUE
       WHERE c.company_id = $1
         AND c.employment_status = '${EMPLOYMENT_STATUS.EMPLOYEE}'
       ORDER BY c.id ASC
       LIMIT $2`,
      [cid, cap, DP_LEAVE_DEFAULT_ENTITLEMENT_DAYS]
    );
    employees = empRes.rows;
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') {
      return {
        ok: true,
        pool: {
          headcount: 0,
          scanned: 0,
          truncated: false,
          scanCap: cap,
          entitlementDays: 0,
          adjustmentDays: 0,
          usedDays: 0,
          pendingDays: 0,
          availableDays: 0,
          periodHint: defaultLeavePeriod(ref),
          byJobRole: [],
        },
      };
    }
    throw err;
  }

  if (employees.length === 0) {
    return {
      ok: true,
      pool: {
        headcount: 0,
        scanned: 0,
        truncated: false,
        scanCap: cap,
        entitlementDays: 0,
        adjustmentDays: 0,
        usedDays: 0,
        pendingDays: 0,
        availableDays: 0,
        periodHint: defaultLeavePeriod(ref),
        byJobRole: [],
      },
    };
  }

  const ids = employees.map((e) => Number(e.candidateId));
  const periodById = new Map();
  for (const e of employees) {
    periodById.set(
      Number(e.candidateId),
      resolveLeavePeriod(
        { periodStart: e.periodStart, periodEnd: e.periodEnd },
        ref
      )
    );
  }

  const usedById = new Map();
  const pendingById = new Map();
  try {
    const usageRes = await db.query(
      `SELECT candidate_id AS "candidateId",
              status,
              starts_on AS "startsOn",
              ends_on AS "endsOn",
              ((ends_on - starts_on) + 1)::float AS days
       FROM employee_leave_requests
       WHERE company_id = $1
         AND candidate_id = ANY($2::bigint[])
         AND leave_type = $3
         AND status IN ('${DP_LEAVE_STATUS.REQUESTED}', '${DP_LEAVE_STATUS.APPROVED}', '${DP_LEAVE_STATUS.TAKEN}')`,
      [cid, ids, DP_LEAVE_TYPE.VACATION]
    );
    for (const row of usageRes.rows) {
      const candId = Number(row.candidateId);
      const period = periodById.get(candId);
      if (!period) continue;
      const starts = dateOrNull(row.startsOn);
      if (!starts || starts < period.periodStart || starts > period.periodEnd) continue;
      const days = toDayNumber(row.days);
      if (row.status === DP_LEAVE_STATUS.REQUESTED) {
        pendingById.set(candId, (pendingById.get(candId) || 0) + days);
      } else {
        usedById.set(candId, (usedById.get(candId) || 0) + days);
      }
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  let entitlementDays = 0;
  let adjustmentDays = 0;
  let usedDays = 0;
  let pendingDays = 0;
  const byRole = new Map();

  for (const e of employees) {
    const candId = Number(e.candidateId);
    const ent = toDayNumber(e.entitlementDays);
    const adj = toDayNumber(e.adjustmentDays);
    const used = toDayNumber(usedById.get(candId) || 0);
    const pending = toDayNumber(pendingById.get(candId) || 0);
    const available = toDayNumber(ent + adj - used - pending);

    entitlementDays += ent;
    adjustmentDays += adj;
    usedDays += used;
    pendingDays += pending;

    const roleLabel = String(e.jobRoleName || '').trim() || null;
    const roleKey = roleLabel || '_none';
    if (!byRole.has(roleKey)) {
      byRole.set(roleKey, {
        id: roleKey,
        label: roleLabel,
        headcount: 0,
        usedDays: 0,
        pendingDays: 0,
        availableDays: 0,
        entitlementDays: 0,
      });
    }
    const bucket = byRole.get(roleKey);
    bucket.headcount += 1;
    bucket.usedDays += used;
    bucket.pendingDays += pending;
    bucket.availableDays += available;
    bucket.entitlementDays += ent + adj;
  }

  const availableDays = toDayNumber(entitlementDays + adjustmentDays - usedDays - pendingDays);
  const byJobRole = [...byRole.values()]
    .map((b) => ({
      ...b,
      label: b.label || null,
      usedDays: toDayNumber(b.usedDays),
      pendingDays: toDayNumber(b.pendingDays),
      availableDays: toDayNumber(b.availableDays),
      entitlementDays: toDayNumber(b.entitlementDays),
    }))
    .sort(
      (a, b) =>
        b.usedDays + b.pendingDays - (a.usedDays + a.pendingDays) ||
        b.headcount - a.headcount
    );

  return {
    ok: true,
    pool: {
      headcount: employees.length,
      scanned: employees.length,
      truncated: employees.length >= cap,
      scanCap: cap,
      entitlementDays: toDayNumber(entitlementDays),
      adjustmentDays: toDayNumber(adjustmentDays),
      usedDays: toDayNumber(usedDays),
      pendingDays: toDayNumber(pendingDays),
      availableDays,
      periodHint: defaultLeavePeriod(ref),
      byJobRole,
    },
  };
}

export {
  DP_DOCUMENT_KEY,
  DP_DOCUMENT_STATUS,
  DP_LEAVE_TYPE,
  DP_LEAVE_STATUS,
};
