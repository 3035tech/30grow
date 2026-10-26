import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/identity/permissions.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  archivePipelineTemplate,
  duplicatePipelineTemplate,
  restorePipelineTemplate,
  updatePipelineTemplate,
} from '../../../../../lib/recruiting/pipeline-templates.js';
import { auditFromRequest } from '../../../../../lib/audit.js';

const companyQuerySchema = z.object({ companyId: zPositiveInt.optional() });
const updateBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
  duplicateName: z.string().trim().min(1).max(80).optional(),
  restore: z.boolean().optional(),
});

function templateIdFrom(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const PATCH = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: updateBodySchema,
    companyFrom: 'body',
    logLabel: 'pipeline-template PATCH',
  },
  async ({ request, companyId, body, params, payload }) => {
    const templateId = templateIdFrom(params);
    if (!templateId) return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    const result = body.restore === true
      ? await restorePipelineTemplate({ companyId, templateId })
      : body.duplicateName
      ? await duplicatePipelineTemplate({ companyId, templateId, name: body.duplicateName })
      : await updatePipelineTemplate({
          companyId,
          templateId,
          name: body.name,
          isDefault: body.isDefault,
        });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    await auditFromRequest(request, {
      actorUserId: payload?.userId || payload?.id || null,
      companyId,
      action: body.restore === true
        ? 'pipeline_template.restored'
        : body.duplicateName
          ? 'pipeline_template.duplicated'
          : body.isDefault === true
            ? 'pipeline_template.default_changed'
            : 'pipeline_template.renamed',
      targetType: 'pipeline_template',
      targetId: result.templateId,
    });
    return NextResponse.json(result);
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    query: companyQuerySchema,
    companyFrom: 'query',
    logLabel: 'pipeline-template DELETE',
  },
  async ({ request, companyId, params, payload }) => {
    const templateId = templateIdFrom(params);
    if (!templateId) return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    const result = await archivePipelineTemplate({ companyId, templateId });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.NOT_FOUND });
    await auditFromRequest(request, {
      actorUserId: payload?.userId || payload?.id || null,
      companyId,
      action: 'pipeline_template.archived',
      targetType: 'pipeline_template',
      targetId: result.templateId,
    });
    return NextResponse.json(result);
  }
);
