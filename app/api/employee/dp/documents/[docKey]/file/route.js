import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../../../../lib/rate-limit.js';
import { auditFromRequest, AUDIT_ACTOR_KIND } from '../../../../../../../lib/audit.js';
import { DP_DOCUMENT_KEYS } from '../../../../../../../lib/domain-status.js';
import { dpDownloadResponse } from '../../../../../../../lib/people/dp-download-response.js';
import {
  clearDpDocumentFile,
  downloadDpDocumentFile,
  getEmployeeDisplayName,
  uploadDpDocumentFile,
} from '../../../../../../../lib/people/employee-dp.js';
import { notifyCompanyManagers } from '../../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../../lib/manager-notification-catalog.js';

export const dynamic = 'force-dynamic';

/** Private bytes; dpDownloadResponse applies Cache-Control: private, no-store. */
export async function GET(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { docKey } = await params;
    if (!DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_ID, 400);
    return dpDownloadResponse(request, `employee:${session.candidateId}`, () =>
      downloadDpDocumentFile({ query }, {
        companyId: session.companyId, candidateId: session.candidateId, docKey,
      })
    );
  } catch {
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/employee/dp/documents/[docKey]/file — collaborator upload. */
export async function POST(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;
    const { docKey } = await params;
    if (!DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(`emp-dp-doc:${candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return apiError(request, ERR.INVALID_DATA, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadDpDocumentFile({ query }, {
      companyId,
      candidateId,
      docKey,
      file: {
        buffer,
        size: buffer.length,
        mimeType: file.type,
        originalName: file.name,
      },
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE, actorCandidateId: candidateId, companyId,
      action: 'dp.document.file_uploaded', targetType: 'candidate', targetId: candidateId,
      metadata: { docKey },
    });

    try {
      const name = await getEmployeeDisplayName(
        { query },
        { companyId, candidateId }
      );
      const today = new Date().toISOString().slice(0, 10);
      await notifyCompanyManagers(query, {
        companyId,
        type: NOTIF.DP_DOC_UPLOADED,
        entityType: 'candidate',
        entityId: candidateId,
        dedupeKey: `dp_doc_up:${candidateId}:${docKey}:${today}`,
        payload: {
          candidateId,
          candidateName: name,
          docKey: String(docKey),
        },
      });
    } catch (e) {
      console.error('[dp] doc upload notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/dp/documents/.../file', err);
    const code = err?.code;
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(code)) {
      return apiError(request, code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : code, 400);
    }
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** DELETE attachment uploaded by collaborator. */
export async function DELETE(request, { params }) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;
    const { docKey } = await params;
    if (!DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_ID, 400);

    const result = await clearDpDocumentFile({ query }, {
      companyId,
      candidateId,
      docKey,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE, actorCandidateId: candidateId, companyId,
      action: 'dp.document.file_removed', targetType: 'candidate', targetId: candidateId,
      metadata: { docKey },
    });
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('DELETE /api/employee/dp/documents/.../file', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
