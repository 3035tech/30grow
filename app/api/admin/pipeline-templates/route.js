import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import {
  createPipelineTemplate,
  createPipelineTemplateFromVacancy,
  listPipelineTemplates,
} from '../../../../lib/recruiting/pipeline-templates.js';
import { auditFromRequest } from '../../../../lib/audit.js';

const listQuerySchema = z.object({ companyId: zPositiveInt.optional() });
const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  vacancyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
});

export const GET = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'pipeline-templates GET',
  },
  async ({ companyId }) => NextResponse.json({
    ok: true,
    templates: await listPipelineTemplates(companyId),
  })
);

export const POST = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'pipeline-templates POST',
  },
  async ({ request, companyId, body, payload }) => {
    const result = body.vacancyId
      ? await createPipelineTemplateFromVacancy({
          companyId,
          vacancyId: body.vacancyId,
          name: body.name,
          isDefault: body.isDefault === true,
        })
      : await createPipelineTemplate({
          companyId,
          name: body.name,
          isDefault: body.isDefault === true,
        });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    await auditFromRequest(request, {
      actorUserId: payload?.userId || payload?.id || null,
      companyId,
      action: body.vacancyId ? 'pipeline_template.saved_from_vacancy' : 'pipeline_template.created',
      targetType: 'pipeline_template',
      targetId: result.templateId,
      metadata: { vacancyId: body.vacancyId || null, isDefault: body.isDefault === true },
    });
    return NextResponse.json(result, { status: 201 });
  }
);
