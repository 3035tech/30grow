import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { listLmsCohorts } from '../../../../../../../lib/development/lms.js';

/** GET /api/admin/lms/courses/[id]/cohorts */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    companyFrom: 'query',
    logLabel: 'lms cohorts GET',
  },
  async ({ request, companyId, params }) => {
    const courseId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(courseId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const result = await listLmsCohorts(null, { companyId, courseId });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json({ ok: true, cohorts: result.cohorts });
  }
);
