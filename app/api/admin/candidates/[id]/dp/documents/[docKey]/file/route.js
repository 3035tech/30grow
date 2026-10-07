import { NextResponse } from 'next/server';
import { query } from '../../../../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../../../lib/api-error.js';
import {
  CAP,
  getManagerScope,
  getSessionPayload,
  requireAnyCapability,
} from '../../../../../../../../../lib/ae/require-admin.js';
import { checkRateLimit } from '../../../../../../../../../lib/rate-limit.js';
import { auditFromRequest } from '../../../../../../../../../lib/audit.js';
import { DP_DOCUMENT_KEYS } from '../../../../../../../../../lib/domain-status.js';
import { zPositiveInt } from '../../../../../../../../../lib/validate.js';
import { dpDownloadResponse } from '../../../../../../../../../lib/people/dp-download-response.js';
import {
  clearDpDocumentFile,
  downloadDpDocumentFile,
  uploadDpDocumentFile,
} from '../../../../../../../../../lib/people/employee-dp.js';

const DP_OR_TEAM = Object.freeze([CAP.DP_VIEW, CAP.TEAM_VIEW]);

async function loadCandidateScope(candidateId, scope) {
  const values = [candidateId];
  const unrestricted = scope.isAdmin && scope.companyId == null;
  const tenantFilter = unrestricted ? '' : 'AND company_id = $2';
  if (!unrestricted) values.push(scope.companyId);
  const c = await query(
    `SELECT id, company_id AS "companyId" FROM candidates WHERE id = $1 ${tenantFilter} LIMIT 1`,
    values
  );
  if (c.rowCount === 0) return { error: ERR.NOT_FOUND };
  return { candidate: c.rows[0] };
}

/** Private bytes; dpDownloadResponse applies Cache-Control: private, no-store. */
export async function GET(request, { params }) {
  try {
    const payload = await getSessionPayload();
    if (!payload) return apiError(request, ERR.UNAUTHORIZED, 401);
    if (!requireAnyCapability(payload, DP_OR_TEAM)) return apiError(request, ERR.FORBIDDEN, 403);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.FORBIDDEN, 403);
    const resolved = await params;
    const candidate = zPositiveInt.safeParse(resolved?.id);
    const docKey = resolved?.docKey;
    if (!candidate.success || !DP_DOCUMENT_KEYS.includes(docKey)) {
      return apiError(request, ERR.INVALID_ID, 400);
    }
    const loaded = await loadCandidateScope(candidate.data, scope);
    if (loaded.error) return apiError(request, loaded.error, 404);
    return dpDownloadResponse(request, `manager:${payload.userId}`, () =>
      downloadDpDocumentFile({ query }, {
        companyId: loaded.candidate.companyId, candidateId: candidate.data, docKey,
      })
    );
  } catch {
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST multipart file upload for a DP document. */
export async function POST(request, { params }) {
  try {
    const payload = await getSessionPayload();
    if (!requireAnyCapability(payload, DP_OR_TEAM)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const resolved = await params;
    const parsed = zPositiveInt.safeParse(resolved?.id);
    const candidateId = parsed.data;
    const docKey = resolved?.docKey;
    if (!parsed.success || !DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_ID, 400);
    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const rl = await checkRateLimit(`dp-doc:${payload.userId}`, 30, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return apiError(request, ERR.INVALID_DATA, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadDpDocumentFile({ query }, {
      companyId: loaded.candidate.companyId,
      candidateId,
      docKey,
      userId: payload.userId,
      file: {
        buffer,
        size: buffer.length,
        mimeType: file.type,
        originalName: file.name,
      },
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId, companyId: loaded.candidate.companyId,
      action: 'dp.document.file_uploaded', targetType: 'candidate', targetId: candidateId,
      metadata: { docKey },
    });
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST dp document file', err);
    const code = err?.code;
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(code)) {
      return apiError(request, code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : code, 400);
    }
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** DELETE attachment */
export async function DELETE(request, { params }) {
  try {
    const payload = await getSessionPayload();
    if (!requireAnyCapability(payload, DP_OR_TEAM)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const resolved = await params;
    const parsed = zPositiveInt.safeParse(resolved?.id);
    const candidateId = parsed.data;
    const docKey = resolved?.docKey;
    if (!parsed.success || !DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_ID, 400);
    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const result = await clearDpDocumentFile({ query }, {
      companyId: loaded.candidate.companyId,
      candidateId,
      docKey,
      userId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId, companyId: loaded.candidate.companyId,
      action: 'dp.document.file_removed', targetType: 'candidate', targetId: candidateId,
      metadata: { docKey },
    });
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('DELETE dp document file', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
