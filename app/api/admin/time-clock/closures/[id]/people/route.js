/**
 * GET  /api/admin/time-clock/closures/[id]/people — per-person summary + acknowledgment (?format=csv)
 * POST /api/admin/time-clock/closures/[id]/people — generate the summary for an older closure
 */

import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { CAP } from '../../../../../../../lib/permissions.js';
import { TIME_CLOCK_ACK_STATUSES } from '../../../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../../../lib/validate.js';
import {
  exportClosurePeopleCsv,
  generateClosurePeople,
  listClosurePeople,
  notifyClosureMirrorsReady,
} from '../../../../../../../lib/people/time-clock-closure-people.js';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  companyId: zPositiveInt.optional(),
  format: z.enum(['json', 'csv']).optional(),
  status: z.enum(/** @type {[string, ...string[]]} */ (TIME_CLOCK_ACK_STATUSES)).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10000).optional(),
  pageSize: z.coerce.number().int().min(5).max(50).optional(),
});

const generateSchema = z.object({ companyId: zPositiveInt.optional() });

const ACCESS = { anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW], requireCompany: true };

export const GET = withAdminApi(
  { ...ACCESS, companyFrom: 'query', query: querySchema, logLabel: 'time-clock-closure-people' },
  async ({ request, companyId, query, params }) => {
    const closureId = Number(params?.id);
    if (query.format === 'csv') {
      const result = await exportClosurePeopleCsv(null, { companyId, closureId });
      if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="espelho-${result.closure.periodStart}_${result.closure.periodEnd}.csv"`,
        },
      });
    }
    const result = await listClosurePeople(null, {
      companyId,
      closureId,
      q: query.q || '',
      status: query.status || null,
      page: query.page,
      pageSize: query.pageSize,
    });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    return NextResponse.json(result);
  }
);

export const POST = withAdminApi(
  { ...ACCESS, companyFrom: 'body', body: generateSchema, logLabel: 'time-clock-closure-people-generate' },
  async ({ request, companyId, params, payload }) => {
    const result = await generateClosurePeople(null, { companyId, closureId: Number(params?.id) });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    if (!result.count) return NextResponse.json({ ok: true, count: 0 });
    await audit({
      actorUserId: payload.userId || null,
      action: 'time_clock.closure_summary_generate',
      companyId,
      targetType: 'time_clock_closure',
      targetId: result.closure.id,
      metadata: { count: result.count },
    });
    try {
      await notifyClosureMirrorsReady(null, {
        companyId,
        closureId: result.closure.id,
        periodStart: result.closure.periodStart,
        periodEnd: result.closure.periodEnd,
        candidateIds: result.candidateIds,
      });
    } catch (e) {
      console.error('[time-clock] mirror notif', e?.message || e);
    }
    return NextResponse.json({ ok: true, count: result.count });
  }
);
