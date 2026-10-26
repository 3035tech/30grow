import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import { getLmsCohortReport } from '../../../../../lib/development/lms.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  courseId: zPositiveInt,
});

/** GET /api/admin/lms/cohort-report?courseId=&companyId= */
export const GET = withAdminApi(
  {
    cap: CAP.LEARNING_VIEW,
    requireCompany: true,
    companyFrom: 'query',
    query: querySchema,
    logLabel: 'lms cohort-report',
  },
  async ({ request, companyId, query }) => {
    const result = await getLmsCohortReport(null, {
      companyId,
      courseId: query.courseId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    }
    return NextResponse.json(result);
  }
);
