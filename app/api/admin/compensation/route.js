import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/identity/permissions.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { listCompanyCompensationRoster } from '../../../../lib/people/employee-compensation.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  q: z.string().trim().max(80).optional().default(''),
  employmentStatus: z
    .enum(['employee', 'alumni', 'all'])
    .optional()
    .default('employee'),
  hasSalary: z.enum(['all', 'with', 'without']).optional().default('all'),
  marketBand: z
    .enum(['all', 'below', 'in_band', 'above', 'no_band'])
    .optional()
    .default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
  sort: z.enum(['name', 'amount', 'effectiveDate', 'eventCount']).optional().default('name'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
});

/**
 * GET /api/admin/compensation — unified salary roster (tenant).
 * Depth: app/api/admin/compensation → 4× ../ até lib/
 */
export const GET = withAdminApi(
  {
    cap: CAP.COMPENSATION_VIEW,
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'compensation roster GET',
  },
  async ({ request, companyId, query }) => {
    const result = await listCompanyCompensationRoster(null, {
      companyId,
      q: query.q,
      employmentStatus: query.employmentStatus,
      hasSalary: query.hasSalary,
      marketBand: query.marketBand,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      sortDir: query.sortDir,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    return NextResponse.json({
      ok: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  }
);
