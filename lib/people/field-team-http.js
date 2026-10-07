/**
 * Collaborator field-team HTTP handlers, bound to the web cookie session or the mobile
 * Bearer session. Route files only re-export the returned handlers.
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../api-error.js';
import { readBoundedFormData, singleFormFile } from '../bounded-multipart.js';
import { DP_DOC_MAX_BYTES } from '../dp-upload-validation.js';
import { getEmployeeSessionPayload } from '../employee-session.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../mobile-employee-session.js';
import { checkRateLimit } from '../rate-limit.js';
import { zPositiveInt } from '../validate.js';
import { dpDownloadResponse } from './dp-download-response.js';
import {
  downloadFieldExpenseReceipt,
  downloadFieldVisitPhoto,
  getEmployeeFieldDay,
  uploadFieldExpenseReceipt,
  uploadFieldVisitPhoto,
} from './field-team.js';
import {
  FIELD_FILE_RATE_LIMIT,
  FIELD_WRITE_RATE_LIMIT,
  FIELD_WRITE_RATE_WINDOW_MS,
  actOnEmployeeFieldVisit,
  submitEmployeeFieldExpense,
  submitEmployeeFieldVisit,
  withdrawEmployeeFieldExpense,
} from './field-team-api.js';

export const FIELD_SESSION = Object.freeze({ WEB: 'web', MOBILE: 'mobile' });
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const FILE_ERRORS = new Set([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE]);

async function sessionFor(kind, request) {
  if (kind === FIELD_SESSION.MOBILE) return authenticateMobileEmployee(mobileEmployeeBearerToken(request));
  return getEmployeeSessionPayload();
}

function json(body, kind) {
  return NextResponse.json(body, kind === FIELD_SESSION.MOBILE ? { headers: NO_STORE } : undefined);
}

/**
 * Wraps auth, optional `[id]` param, write rate limit and error mapping.
 * `fn({ request, session, id })` returns a NextResponse or a `{ ok, errorCode }` result.
 */
function handler(kind, label, fn, { withId = false, rate = null } = {}) {
  return async (request, ctx) => {
    try {
      const session = await sessionFor(kind, request);
      if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
      let id = null;
      if (withId) {
        const parsed = zPositiveInt.safeParse((await ctx?.params)?.id);
        if (!parsed.success) return apiError(request, ERR.INVALID_ID, HTTP_STATUS.BAD_REQUEST);
        id = parsed.data;
      }
      if (rate) {
        const rl = await checkRateLimit(`${rate.key}:${session.candidateId}`, rate.limit, FIELD_WRITE_RATE_WINDOW_MS);
        if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
      }
      const out = await fn({ request, session, id });
      if (out instanceof Response) return out;
      if (!out?.ok) return apiErrorFromResult(request, out);
      return json(out, kind);
    } catch (err) {
      if (FILE_ERRORS.has(err?.code)) return apiError(request, err.code, HTTP_STATUS.BAD_REQUEST);
      console.error(`[field] ${kind} ${label}`, err?.message || err);
      return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  };
}

async function readUpload(request) {
  const file = singleFormFile(await readBoundedFormData(request, DP_DOC_MAX_BYTES));
  if (!file) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, size: buffer.length, mimeType: file.type, originalName: file.name };
}

const writeRate = { key: 'emp-field-write', limit: FIELD_WRITE_RATE_LIMIT };
const fileRate = { key: 'emp-field-file', limit: FIELD_FILE_RATE_LIMIT };

/** Handlers for one session kind; each key matches a route file. */
export function fieldEmployeeHandlers(kind) {
  return Object.freeze({
    day: handler(kind, 'day', async ({ request, session }) => {
      const day = new URL(request.url).searchParams.get('day') || '';
      return getEmployeeFieldDay(null, { companyId: session.companyId, candidateId: session.candidateId, day });
    }),
    createVisit: handler(kind, 'visit', async ({ request, session }) => (
      submitEmployeeFieldVisit(request, session, await request.json().catch(() => ({})))
    ), { rate: writeRate }),
    visitAction: handler(kind, 'visit-action', async ({ request, session, id }) => (
      actOnEmployeeFieldVisit(request, session, id, await request.json().catch(() => ({})))
    ), { withId: true, rate: writeRate }),
    visitPhotoGet: handler(kind, 'visit-photo', async ({ request, session, id }) => (
      dpDownloadResponse(request, `employee:${session.candidateId}`, () =>
        downloadFieldVisitPhoto({ companyId: session.companyId, candidateId: session.candidateId, id }))
    ), { withId: true }),
    visitPhotoPost: handler(kind, 'visit-photo-upload', async ({ request, session, id }) => {
      const file = await readUpload(request);
      if (!file) return { ok: false, errorCode: ERR.INVALID_DATA };
      return uploadFieldVisitPhoto({ companyId: session.companyId, candidateId: session.candidateId, id, file });
    }, { withId: true, rate: fileRate }),
    createExpense: handler(kind, 'expense', async ({ request, session }) => (
      submitEmployeeFieldExpense(request, session, await request.json().catch(() => ({})))
    ), { rate: writeRate }),
    cancelExpense: handler(kind, 'expense-cancel', async ({ request, session, id }) => (
      withdrawEmployeeFieldExpense(request, session, id)
    ), { withId: true, rate: writeRate }),
    receiptGet: handler(kind, 'receipt', async ({ request, session, id }) => (
      dpDownloadResponse(request, `employee:${session.candidateId}`, () =>
        downloadFieldExpenseReceipt({ companyId: session.companyId, candidateId: session.candidateId, id }))
    ), { withId: true }),
    receiptPost: handler(kind, 'receipt-upload', async ({ request, session, id }) => {
      const file = await readUpload(request);
      if (!file) return { ok: false, errorCode: ERR.INVALID_DATA };
      return uploadFieldExpenseReceipt({ companyId: session.companyId, candidateId: session.candidateId, id, file });
    }, { withId: true, rate: fileRate }),
  });
}
