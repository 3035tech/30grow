import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  createCompanyPost,
  listCompanyPosts,
} from '../../../../../lib/company/company-posts.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  q: z.string().trim().max(80).optional().default(''),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(20000).optional().nullable(),
});

/** GET /api/admin/company-feed/posts */
export const GET = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'company-feed posts GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listCompanyPosts(null, {
      companyId,
      page: query.page,
      pageSize: query.pageSize,
      q: query.q,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    }
    return NextResponse.json(result);
  }
);

/** POST /api/admin/company-feed/posts */
export const POST = withAdminApi(
  {
    cap: CAP.COMPANY_FEED_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'company-feed posts POST',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await createCompanyPost(null, {
      companyId,
      title: body.title,
      bodyHtml: body.bodyHtml,
      createdByUserId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    return NextResponse.json(result, { status: 201 });
  }
);
