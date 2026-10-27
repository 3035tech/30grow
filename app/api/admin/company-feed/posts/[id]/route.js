import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import {
  softDeleteCompanyPost,
  updateCompanyPost,
} from '../../../../../../lib/company/company-posts.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(20000).optional().nullable(),
});

function parseId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** PATCH /api/admin/company-feed/posts/[id] */
export const PATCH = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'company-feed posts PATCH',
  },
  async ({ request, companyId, body, params }) => {
    const postId = parseId(params);
    if (!postId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await updateCompanyPost(null, {
      companyId,
      postId,
      title: body.title,
      bodyHtml: body.bodyHtml,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json(result);
  }
);

/** DELETE /api/admin/company-feed/posts/[id] */
export const DELETE = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    companyFrom: 'query',
    query: z.object({ companyId: zPositiveInt.optional() }),
    logLabel: 'company-feed posts DELETE',
  },
  async ({ request, companyId, params }) => {
    const postId = parseId(params);
    if (!postId) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = await softDeleteCompanyPost(null, { companyId, postId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json({ ok: true });
  }
);
