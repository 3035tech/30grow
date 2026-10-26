import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../../lib/validate.js';
import {
  listJobRoleLmsTrail,
  setJobRoleLmsTrail,
} from '../../../../../../lib/development/lms-job-role-trail.js';
import { audit } from '../../../../../../lib/audit.js';

const putBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  items: z
    .array(
      z.object({
        courseId: zPositiveInt,
        mandatory: z.boolean().optional(),
        dueOffsetDays: z.number().int().min(1).max(365).optional(),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
    )
    .max(40),
});

/** GET /api/admin/job-roles/[id]/lms-trail */
export const GET = withAdminApi(
  {
    cap: CAP.JOB_ROLES_VIEW,
    companyFrom: 'query',
    logLabel: 'job-role lms trail GET',
  },
  async ({ request, companyId, params }) => {
    const jobRoleId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(jobRoleId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await listJobRoleLmsTrail(null, { companyId, jobRoleId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, items: result.items });
  }
);

/** PUT /api/admin/job-roles/[id]/lms-trail */
export const PUT = withAdminApi(
  {
    cap: CAP.JOB_ROLES_VIEW,
    body: putBodySchema,
    companyFrom: 'body',
    logLabel: 'job-role lms trail PUT',
  },
  async ({ request, companyId, body, params, payload }) => {
    const jobRoleId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(jobRoleId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_ID });
    }
    const result = await setJobRoleLmsTrail(null, {
      companyId,
      jobRoleId,
      items: body.items || [],
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload?.userId || null,
      companyId,
      action: 'lms.job_role_trail.set',
      targetType: 'job_role',
      targetId: jobRoleId,
      metadata: { count: result.items?.length || 0 },
    }).catch(() => {});
    return NextResponse.json({ ok: true, items: result.items });
  }
);
