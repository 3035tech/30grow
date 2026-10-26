import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { z, zPositiveInt, zQueryBool } from '../../../../../lib/validate.js';
import { createLmsCourse, listLmsCourses } from '../../../../../lib/development/lms.js';
import { audit } from '../../../../../lib/audit.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  includeInactive: zQueryBool,
  q: z.string().trim().max(80).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(80).optional().default(40),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(8000).optional().nullable(),
  completionPct: z.coerce.number().int().min(1).max(100).optional().default(100),
});

/** GET /api/admin/lms/courses */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'lms courses GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listLmsCourses(null, {
      companyId,
      includeInactive: query.includeInactive,
      q: query.q || '',
      limit: query.limit,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INTERNAL });
    }
    return NextResponse.json({ ok: true, courses: result.courses });
  }
);

/** POST /api/admin/lms/courses */
export const POST = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'lms courses POST',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await createLmsCourse(null, {
      companyId,
      title: body.title,
      description: body.description || '',
      completionPct: body.completionPct,
      createdByUserId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    await audit({
      actorUserId: payload.userId || null,
      action: 'lms.course.create',
      targetType: 'lms_course',
      targetId: String(result.course.id),
    });
    return NextResponse.json({ ok: true, course: result.course }, { status: 201 });
  }
);
