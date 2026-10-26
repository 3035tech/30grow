/**
 * B-2706 — CV upload (PDF), text extraction, field suggestions, vacancy text match.
 */

import crypto from 'node:crypto';
// pdf-parse default entry runs a test file on import — use lib entry.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { query, queryRead } from '../db.js';
import { ERR } from '../api-error-codes.js';
import { isPdfBuffer } from '../file-magic.js';
import {
  isObjectStorageConfigured,
  putObject,
  deleteObjectBestEffort,
  companyScopedObjectKey,
} from '../s3-object-storage.js';

export const CV_PDF_MAX_BYTES = 5 * 1024 * 1024;
export const CV_TEXT_MAX_CHARS = 100_000;
export const CV_PDF_MIME = 'application/pdf';

const ALLOWED_DECLARED_PDF_MIMES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/acrobat',
  '',
]);

export function isCvStorageConfigured() {
  return isObjectStorageConfigured();
}

export function assertValidCvPdfFile(file = {}) {
  const mimeType = String(file.mimeType || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
  const size = Number(file.size);
  const bufLen = Buffer.isBuffer(file.buffer) ? file.buffer.length : size;
  if (!Number.isFinite(bufLen) || bufLen <= 0 || bufLen > CV_PDF_MAX_BYTES) {
    const err = new Error(ERR.INVALID_CV_FILE_SIZE);
    err.code = ERR.INVALID_CV_FILE_SIZE;
    throw err;
  }

  if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    if (!isPdfBuffer(file.buffer)) {
      const err = new Error(ERR.INVALID_CV_FILE_TYPE);
      err.code = ERR.INVALID_CV_FILE_TYPE;
      throw err;
    }
    return { mimeType: CV_PDF_MIME };
  }

  if (!ALLOWED_DECLARED_PDF_MIMES.has(mimeType)) {
    const err = new Error(ERR.INVALID_CV_FILE_TYPE);
    err.code = ERR.INVALID_CV_FILE_TYPE;
    throw err;
  }
  return { mimeType: CV_PDF_MIME };
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
export async function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  try {
    // Isolate the byte view: pooled Node Buffers have nonzero offsets that the legacy PDF.js reader mishandles.
    const parsed = await pdfParse(new Uint8Array(buffer));
    const raw = String(parsed?.text || '').replace(/\0/g, '').trim();
    return raw.slice(0, CV_TEXT_MAX_CHARS);
  } catch (e) {
    const err = new Error(ERR.CV_PARSE_FAILED);
    err.code = ERR.CV_PARSE_FAILED;
    err.cause = e;
    throw err;
  }
}

/**
 * Heuristic field suggestions from CV text (no LLM).
 * @param {string} text
 */
export function suggestFieldsFromCvText(text) {
  const src = String(text || '');
  const suggestions = {};

  const emailMatch = src.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) suggestions.email = emailMatch[0].toLowerCase().slice(0, 254);

  const phoneMatch =
    src.match(/(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/) ||
    src.match(/\+?\d[\d\s().-]{8,}\d/);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) suggestions.phone = phoneMatch[0].trim().slice(0, 40);
  }

  const lines = src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && l.length <= 80);
  for (const line of lines.slice(0, 12)) {
    if (/@/.test(line)) continue;
    if (/^\d/.test(line)) continue;
    if (/^(curriculum|curriculo|resume|cv|experi|education|formac|habilid|skills|contato|contact)/i.test(line)) {
      continue;
    }
    if (/^[A-ZÀ-Ú][a-zà-ú]+(?: [A-ZÀ-Ú][a-zà-ú]+){1,4}$/.test(line)) {
      suggestions.fullName = line.slice(0, 200);
      break;
    }
  }

  const linkedinMatch = src.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);
  if (linkedinMatch) suggestions.linkedinUrl = linkedinMatch[0].slice(0, 500);

  return suggestions;
}

const STOP_WORDS = new Set([
  'a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'por', 'um', 'uma', 'the', 'and', 'or',
  'to', 'of', 'in', 'for', 'on', 'at', 'is', 'are', 'be', 'as', 'an', 'that', 'this', 'it', 'we', 'you', 'your',
  'our', 'will', 'have', 'has', 'not', 'from', 'with', 'que', 'na', 'no', 'nos', 'nas', 'se', 'ou', 'como', 'mais',
]);

function tokenizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * Simple token overlap 0–100 — **textMatch**, not T1–T9 Fit.
 * @param {{ cvText?: string, vacancyDescription?: string }} opts
 */
export function scoreCvTextAgainstVacancy({ cvText, vacancyDescription }) {
  const cvTokens = new Set(tokenizeForMatch(cvText));
  const vacTokens = tokenizeForMatch(vacancyDescription);
  if (!cvTokens.size || !vacTokens.length) {
    return { textMatchScore: null, textMatchLabel: null, matchedTokenCount: 0, vacancyTokenCount: vacTokens.length };
  }
  const vacUnique = [...new Set(vacTokens)];
  let matched = 0;
  for (const t of vacUnique) {
    if (cvTokens.has(t)) matched += 1;
  }
  const ratio = vacUnique.length ? matched / vacUnique.length : 0;
  const textMatchScore = Math.round(Math.min(1, ratio) * 100);
  let textMatchLabel = 'low';
  if (textMatchScore >= 70) textMatchLabel = 'high';
  else if (textMatchScore >= 40) textMatchLabel = 'medium';
  return {
    textMatchScore,
    textMatchLabel,
    matchedTokenCount: matched,
    vacancyTokenCount: vacUnique.length,
  };
}

async function loadCandidateScope(candidateId, companyId, isAdmin) {
  const cid = Number(candidateId);
  if (!Number.isFinite(cid) || cid <= 0) return { ok: false, errorCode: ERR.INVALID_ID };
  const res = await queryRead(
    `SELECT id, company_id AS "companyId", cv_url AS "cvUrl", cv_key AS "cvKey",
            cv_extracted_text AS "cvExtractedText", cv_updated_at AS "cvUpdatedAt",
            full_name AS "fullName", email, phone, linkedin_url AS "linkedinUrl",
            professional_summary AS "professionalSummary", professional_summary_updated_at AS "professionalSummaryUpdatedAt"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [cid]
  );
  if (res.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  const row = res.rows[0];
  if (!isAdmin && Number(row.companyId) !== Number(companyId)) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  return { ok: true, candidate: row };
}

export function cvMetaFromRow(row, { includeText = false } = {}) {
  const hasCv = Boolean(row.cvUrl || row.cvKey);
  const meta = {
    hasCv,
    cvUrl: row.cvUrl || null,
    cvUpdatedAt: row.cvUpdatedAt || null,
    textLength: row.cvExtractedText ? row.cvExtractedText.length : 0,
  };
  if (includeText && row.cvExtractedText) {
    meta.cvExtractedText = row.cvExtractedText;
  }
  return meta;
}

/**
 * @param {{ candidateId: number, companyId: number|null, isAdmin: boolean, includeText?: boolean }} opts
 */
export async function getCandidateCv(opts) {
  const loaded = await loadCandidateScope(opts.candidateId, opts.companyId, opts.isAdmin);
  if (!loaded.ok) return loaded;
  const row = loaded.candidate;
  const suggestions = row.cvExtractedText
    ? suggestFieldsFromCvText(row.cvExtractedText)
    : {};
  return {
    ok: true,
    cv: cvMetaFromRow(row, { includeText: opts.includeText }),
    suggestions,
    professionalSummary: row.professionalSummary || null,
    professionalSummaryUpdatedAt: row.professionalSummaryUpdatedAt || null,
    candidateFields: {
      fullName: row.fullName || null,
      email: row.email || null,
      phone: row.phone || null,
      linkedinUrl: row.linkedinUrl || null,
    },
  };
}

/**
 * @param {{ candidateId: number, companyId: number, file: { buffer: Buffer, mimeType?: string, size?: number } }} opts
 */
export async function uploadCandidateCv(opts) {
  if (!isCvStorageConfigured()) {
    return { ok: false, errorCode: ERR.STORAGE_NOT_CONFIGURED };
  }
  const cid = Number(opts.candidateId);
  const companyId = Number(opts.companyId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const owned = await queryRead(
    `SELECT id, cv_key AS "cvKey" FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cid, companyId]
  );
  if (owned.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };

  try {
    assertValidCvPdfFile(opts.file);
  } catch (e) {
    return { ok: false, errorCode: e?.code || ERR.INVALID_CV_FILE_TYPE };
  }

  let extractedText = '';
  try {
    extractedText = await extractPdfText(opts.file.buffer);
  } catch {
    // Valid PDF signature/size already checked. Scanned or unsupported documents
    // can still be read by the AI file-input path; no profile is changed on upload.
    extractedText = '';
  }

  const oldKey = owned.rows[0].cvKey;
  const key = companyScopedObjectKey(companyId, 'candidates', String(cid), `${crypto.randomUUID()}.pdf`);

  let url;
  try {
    const uploaded = await putObject({
      key,
      body: opts.file.buffer,
      contentType: CV_PDF_MIME,
    });
    url = uploaded.url;
    if (!url) return { ok: false, errorCode: ERR.STORAGE_UPLOAD_FAILED };
  } catch (e) {
    return { ok: false, errorCode: e?.code || ERR.STORAGE_UPLOAD_FAILED };
  }

  const suggestions = suggestFieldsFromCvText(extractedText);

  const up = await query(
    `UPDATE candidates
     SET cv_url = $2, cv_key = $3, cv_extracted_text = $4, cv_updated_at = NOW()
     WHERE id = $1 AND company_id = $5
     RETURNING cv_url AS "cvUrl", cv_key AS "cvKey", cv_extracted_text AS "cvExtractedText",
               cv_updated_at AS "cvUpdatedAt"`,
    [cid, url, key, extractedText || null, companyId]
  );
  if (up.rowCount === 0) {
    await deleteObjectBestEffort(key);
    return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  }

  if (oldKey && oldKey !== key) await deleteObjectBestEffort(oldKey);

  return {
    ok: true,
    cv: cvMetaFromRow(up.rows[0], { includeText: true }),
    suggestions,
  };
}

/**
 * @param {{ candidateId: number, companyId: number }} opts
 */
export async function removeCandidateCv(opts) {
  const cid = Number(opts.candidateId);
  const companyId = Number(opts.companyId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(companyId) || companyId <= 0) {
    return { ok: false, errorCode: ERR.INVALID_DATA };
  }

  const row = await queryRead(
    `SELECT cv_key AS "cvKey" FROM candidates WHERE id = $1 AND company_id = $2 LIMIT 1`,
    [cid, companyId]
  );
  if (row.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  const oldKey = row.rows[0].cvKey;

  const up = await query(
    `UPDATE candidates
     SET cv_url = NULL, cv_key = NULL, cv_extracted_text = NULL, cv_updated_at = NULL
     WHERE id = $1 AND company_id = $2
     RETURNING id`,
    [cid, companyId]
  );
  if (up.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };

  if (oldKey) await deleteObjectBestEffort(oldKey);
  return { ok: true };
}
