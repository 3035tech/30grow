import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { auditFromRequest } from '../../../../lib/audit.js';
import { CAP } from '../../../../lib/permissions.js';
import { RECRUITING_UX_EVENTS } from '../../../../lib/recruiting/recruiting-ux-events.js';
import { getRecruitingUxMetrics } from '../../../../lib/recruiting/recruiting-ux-metrics.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  event: z.enum(RECRUITING_UX_EVENTS),
  vacancyId: zPositiveInt.optional(),
  templateId: zPositiveInt.optional(),
  elapsedMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});
const querySchema = z.object({ companyId: zPositiveInt.optional() });

export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    query: querySchema,
    companyFrom: 'query',
    logLabel: 'recruiting UX metrics GET',
  },
  async ({ companyId }) => NextResponse.json({
    ok: true,
    metrics: await getRecruitingUxMetrics(companyId),
  })
);

export const POST = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'recruiting UX event POST',
  },
  async ({ request, payload, companyId, body }) => {
    await auditFromRequest(request, {
      actorUserId: payload?.userId || payload?.id || null,
      companyId,
      action: `recruiting.ux.${body.event}`,
      targetType: body.vacancyId ? 'vacancy' : 'recruiting_flow',
      targetId: body.vacancyId || null,
      metadata: {
        templateId: body.templateId || null,
        elapsedMs: body.elapsedMs || null,
      },
    });
    return NextResponse.json({ ok: true });
  }
);
