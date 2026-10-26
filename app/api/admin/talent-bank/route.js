import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { listTalentBank } from '../../../../lib/recruiting/talent-bank.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';

import { candidateTagFilterShape } from '../../../../lib/recruiting/candidate-tags-validation.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  ...candidateTagFilterShape,
  q: z.string().trim().max(120).optional(),
  vacancyId: zPositiveInt.optional(),
  stage: z.string().trim().max(40).optional(),
  topType: z.coerce.number().int().min(1).max(9).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  sort: z.string().trim().max(40).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

/**
 * GET /api/admin/talent-bank
 * Talent bank list — vacancies.view (same gate as Vacancies).
 */
export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'talent-bank GET',
  },
  async ({ companyId, query }) => {
    const data = await listTalentBank(null, {
      companyId,
      tagIds: query.tagIds,
      tagMode: query.tagMode,
      q: query.q || '',
      vacancyId: query.vacancyId ?? null,
      stage: query.stage || null,
      topType: query.topType ?? null,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      sortDir: query.sortDir,
    });
    return NextResponse.json({ ok: true, ...data });
  }
);
