import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  updateCompanyPipelineStage,
  deleteCompanyPipelineStage,
  PIPELINE_CANONICAL_KEYS,
} from '../../../../../lib/company/company-pipeline-stages.js';
import {
  deletePipelineTemplateStage,
  deleteVacancyPipelineStage,
  updatePipelineTemplateStage,
  updateVacancyPipelineStage,
} from '../../../../../lib/recruiting/pipeline-templates.js';

const patchBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  labelPt: z.string().trim().min(1).max(60).optional(),
  labelEn: z.string().trim().min(1).max(60).optional(),
  canonicalKey: z.enum(/** @type {[string, ...string[]]} */ (PIPELINE_CANONICAL_KEYS)).optional(),
  vacancyId: zPositiveInt.optional(),
  templateId: zPositiveInt.optional(),
});

function parseStageId(params) {
  const id = Number(params?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * PATCH  /api/admin/pipeline-stages/[id] — rename labels / change canonical (custom + seed non-required)
 * DELETE /api/admin/pipeline-stages/[id] — soft delete (blocked when in use or required)
 */

export const PATCH = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    body: patchBodySchema,
    companyFrom: 'body',
    logLabel: 'pipeline-stages/[id] PATCH',
  },
  async ({ request, companyId, params, body }) => {
    const id = parseStageId(params);
    if (!id) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = body.templateId
      ? await updatePipelineTemplateStage({
        companyId,
        templateId: body.templateId,
        id,
        labelPt: body.labelPt,
        labelEn: body.labelEn,
        canonicalKey: body.canonicalKey,
      })
      : body.vacancyId
      ? await updateVacancyPipelineStage({
        companyId,
        vacancyId: body.vacancyId,
        id,
        labelPt: body.labelPt,
        labelEn: body.labelEn,
        canonicalKey: body.canonicalKey,
      })
      : await updateCompanyPipelineStage({
      companyId,
      id,
      labelPt: body.labelPt,
      labelEn: body.labelEn,
      canonicalKey: body.canonicalKey,
      });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UPDATE_FAILED });
    }
    return NextResponse.json({ ok: true, stage: result.stage }, { status: 200 });
  }
);

export const DELETE = withAdminApi(
  {
    cap: CAP.VACANCIES_MANAGE,
    query: z.object({ companyId: zPositiveInt.optional(), vacancyId: zPositiveInt.optional(), templateId: zPositiveInt.optional() }),
    companyFrom: 'query',
    logLabel: 'pipeline-stages/[id] DELETE',
  },
  async ({ request, companyId, params, query }) => {
    const id = parseStageId(params);
    if (!id) {
      return apiError(request, ERR.INVALID_ID, httpStatusForError(ERR.INVALID_ID));
    }
    const result = query.templateId
      ? await deletePipelineTemplateStage({ companyId, templateId: query.templateId, id })
      : query.vacancyId
      ? await deleteVacancyPipelineStage({ companyId, vacancyId: query.vacancyId, id })
      : await deleteCompanyPipelineStage({ companyId, id });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.DELETE_FAILED });
    }
    return NextResponse.json({ ok: true, id: result.id }, { status: 200 });
  }
);
