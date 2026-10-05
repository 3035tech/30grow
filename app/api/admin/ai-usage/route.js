import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/permissions.js';
import { queryRead } from '../../../../lib/db.js';
import { z } from '../../../../lib/validate.js';
import { AI_FEATURE, aiDefaultCompanyMonthlyLimit, listAiUsageReport } from '../../../../lib/ai-usage.js';

const querySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  feature: z.enum(Object.values(AI_FEATURE)).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/admin/ai-usage — consumo de IA do mês por empresa (B-2706). Só admin de empresas.
 * Depth: app/api/admin/ai-usage → 4× ../ até lib/
 */
export const GET = withAdminApi(
  {
    cap: CAP.COMPANIES_MANAGE,
    query: querySchema,
    requireCompany: false,
    companyFrom: 'none',
    logLabel: 'ai-usage GET',
  },
  async ({ query }) => {
    const report = await listAiUsageReport({ queryRead }, query || {});
    return NextResponse.json({ ok: true, ...report, defaultLimit: aiDefaultCompanyMonthlyLimit() });
  }
);
