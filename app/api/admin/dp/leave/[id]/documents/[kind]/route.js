import { NextResponse } from 'next/server';
import { auditFromRequest } from '../../../../../../../../lib/audit.js';
import { withAdminApi } from '../../../../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../../lib/db.js';
import { CAP } from '../../../../../../../../lib/identity/permissions.js';
import { checkRateLimit } from '../../../../../../../../lib/identity/rate-limit.js';
import { dpDownloadResponse } from '../../../../../../../../lib/people/dp-download-response.js';
import {
  VACATION_DOCUMENT_TYPES,
  clearVacationDocument,
  downloadVacationDocument,
  uploadVacationDocument,
} from '../../../../../../../../lib/people/employee-dp.js';
import { zPositiveInt } from '../../../../../../../../lib/validate.js';

const options = { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], requireCompany: true, companyFrom: 'query' };

function documentParams(params) {
  const parsed = zPositiveInt.safeParse(params?.id);
  if (!parsed.success || !VACATION_DOCUMENT_TYPES.includes(params?.kind)) return null;
  return { id: parsed.data, documentType: params.kind };
}

export const GET = withAdminApi({ ...options, logLabel: 'vacation-document-download' }, async ({ request, payload, params, companyId }) => {
  const doc = documentParams(params);
  if (!doc) return apiError(request, ERR.INVALID_DATA, 400);
  return dpDownloadResponse(request, `manager:${payload.userId}`, () =>
    downloadVacationDocument({ query }, { ...doc, companyId })
  );
});

export const POST = withAdminApi({ ...options, logLabel: 'vacation-document-upload' }, async ({ request, payload, params, companyId }) => {
  const doc = documentParams(params);
  if (!doc) return apiError(request, ERR.INVALID_DATA, 400);
  const rate = await checkRateLimit(`vacation-document:${payload.userId}`, 30, 60 * 60 * 1000);
  if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, 429);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return apiError(request, ERR.INVALID_DATA, 400);
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadVacationDocument({ query }, {
      ...doc, companyId, userId: payload.userId,
      file: { buffer, size: buffer.length, mimeType: file.type, originalName: file.name },
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await auditFromRequest(request, {
      actorUserId: payload.userId, companyId,
      action: 'dp.vacation_document.uploaded', targetType: 'employee_leave_request', targetId: doc.id,
      metadata: { documentType: doc.documentType },
    });
    return NextResponse.json(result);
  } catch (error) {
    if ([ERR.INVALID_CV_FILE_SIZE, ERR.INVALID_CV_FILE_TYPE, ERR.DP_FILE_SIZE, ERR.DP_FILE_TYPE].includes(error?.code)) {
      const code = error.code === ERR.INVALID_CV_FILE_SIZE ? ERR.DP_FILE_SIZE : error.code === ERR.INVALID_CV_FILE_TYPE ? ERR.DP_FILE_TYPE : error.code;
      return apiError(request, code, 400);
    }
    throw error;
  }
});

export const DELETE = withAdminApi({ ...options, logLabel: 'vacation-document-delete' }, async ({ request, payload, params, companyId }) => {
  const doc = documentParams(params);
  if (!doc) return apiError(request, ERR.INVALID_DATA, 400);
  const result = await clearVacationDocument({ query }, { ...doc, companyId });
  if (!result.ok) return apiErrorFromResult(request, result);
  await auditFromRequest(request, {
    actorUserId: payload.userId, companyId,
    action: 'dp.vacation_document.deleted', targetType: 'employee_leave_request', targetId: doc.id,
    metadata: { documentType: doc.documentType },
  });
  return NextResponse.json(result);
});
