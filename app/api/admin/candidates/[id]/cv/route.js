import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CANDIDATE_ACCESS_CAPS } from '../../../../../../lib/identity/permissions.js';
import {
  apiError,
  apiErrorFromResult,
  ERR,
  httpStatusForError,
} from '../../../../../../lib/api-error.js';
import {
  CV_PDF_MAX_BYTES,
  getCandidateCv,
  isCvStorageConfigured,
  removeCandidateCv,
  uploadCandidateCv,
} from '../../../../../../lib/recruiting/candidate-cv.js';
import { queryRead } from '../../../../../../lib/db.js';
import { audit } from '../../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../../lib/identity/rate-limit.js';

export const runtime = 'nodejs';

async function resolveCandidateCompanyId(candidateId, scope) {
  const cidRes = await queryRead(
    `SELECT company_id AS "companyId" FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (cidRes.rowCount === 0) return { ok: false, errorCode: ERR.CANDIDATE_NOT_FOUND };
  const rowCompanyId = Number(cidRes.rows[0].companyId);
  if (!scope.isAdmin && Number(scope.companyId) !== rowCompanyId) {
    return { ok: false, errorCode: ERR.UNAUTHORIZED };
  }
  return { ok: true, companyId: rowCompanyId };
}

/** GET /api/admin/candidates/[id]/cv — meta; ?includeText=1 for extracted text */
export const GET = withAdminApi(
  {
    anyCap: [...CANDIDATE_ACCESS_CAPS],
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'candidate cv get',
  },
  async ({ request, scope, params }) => {
    const candidateId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(candidateId)) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const includeText = new URL(request.url).searchParams.get('includeText') === '1';
    const result = await getCandidateCv({
      candidateId,
      companyId: scope.companyId,
      isAdmin: scope.isAdmin,
      includeText,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json(result);
  }
);

/** POST /api/admin/candidates/[id]/cv — multipart file (PDF) */
export const POST = withAdminApi(
  {
    anyCap: [...CANDIDATE_ACCESS_CAPS],
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'candidate cv upload',
  },
  async ({ request, payload, scope, params }) => {
    const candidateId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(candidateId)) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }

    if (!isCvStorageConfigured()) {
      return apiError(request, ERR.STORAGE_NOT_CONFIGURED, httpStatusForError(ERR.STORAGE_NOT_CONFIGURED));
    }

    const rl = await checkRateLimit(`cv-upload:${payload.userId || 'anon'}`, 15, 60_000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));
    }

    const owned = await resolveCandidateCompanyId(candidateId, scope);
    if (!owned.ok) {
      return apiErrorFromResult(request, owned, { fallbackCode: ERR.CANDIDATE_NOT_FOUND });
    }

    let form;
    try {
      form = await request.formData();
    } catch {
      return apiError(request, ERR.VALIDATION, httpStatusForError(ERR.VALIDATION));
    }

    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return apiError(request, ERR.INVALID_CV_FILE_TYPE, httpStatusForError(ERR.INVALID_CV_FILE_TYPE));
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > CV_PDF_MAX_BYTES) {
      return apiError(request, ERR.INVALID_CV_FILE_SIZE, httpStatusForError(ERR.INVALID_CV_FILE_SIZE));
    }

    const result = await uploadCandidateCv({
      candidateId,
      companyId: owned.companyId,
      file: { buffer: buf, mimeType: file.type || 'application/pdf', size: buf.length },
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.STORAGE_UPLOAD_FAILED });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'candidate.cv_upload',
      targetType: 'candidate',
      targetId: String(candidateId),
    });

    return NextResponse.json({ ok: true, cv: result.cv, suggestions: result.suggestions });
  }
);

/** DELETE /api/admin/candidates/[id]/cv */
export const DELETE = withAdminApi(
  {
    anyCap: [...CANDIDATE_ACCESS_CAPS],
    companyFrom: 'none',
    requireCompany: false,
    logLabel: 'candidate cv delete',
  },
  async ({ request, payload, scope, params }) => {
    const candidateId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(candidateId)) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }

    const owned = await resolveCandidateCompanyId(candidateId, scope);
    if (!owned.ok) {
      return apiErrorFromResult(request, owned, { fallbackCode: ERR.CANDIDATE_NOT_FOUND });
    }

    const result = await removeCandidateCv({ candidateId, companyId: owned.companyId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'candidate.cv_delete',
      targetType: 'candidate',
      targetId: String(candidateId),
    });

    return NextResponse.json({ ok: true });
  }
);
