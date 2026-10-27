import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import {
  getSessionPayload,
  isSuperAdminPayload,
  CAP,
  requireCapability,
} from '../../../../../lib/ae/require-admin.js';
import { getJobRole, updateJobRole, deactivateJobRole } from '../../../../../lib/recruiting/job-roles.js';

/**
 * GET /api/admin/job-roles/[id]
 * Retorna detalhes de um cargo
 */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.JOB_ROLES_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const jobRole = await getJobRole(id);

    if (!jobRole) {
      return apiError(request, ERR.JOB_ROLE_NOT_FOUND, 404);
    }

    // Verificar se o cargo pertence à empresa do usuário
    if (!isAdmin && jobRole.companyId !== payload.companyId) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    return Response.json(jobRole);
  } catch (err) {
    if(err?.code===ERR.POSITION_IN_USE)return apiErrorFromResult(request,{errorCode:err.code});
    console.error('[job-roles] GET [id] error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/**
 * PATCH /api/admin/job-roles/[id]
 * Atualiza cargo existente
 * Body: { name?, description?, rubric?, active? }
 */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.JOB_ROLES_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    // Verificar se o cargo existe e pertence à empresa
    const existingRole = await getJobRole(id);

    if (!existingRole) {
      return apiError(request, ERR.JOB_ROLE_NOT_FOUND, 404);
    }

    if (!isAdmin && existingRole.companyId !== payload.companyId) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { name, description, rubric, active, marketSalaryMin, marketSalaryMax } = body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (rubric !== undefined) updates.rubric = rubric;
    if (active !== undefined) updates.active = active;
    if (marketSalaryMin !== undefined) updates.marketSalaryMin = marketSalaryMin;
    if (marketSalaryMax !== undefined) updates.marketSalaryMax = marketSalaryMax;

    if (Object.keys(updates).length === 0) {
      return apiError(request, ERR.NO_UPDATES_PROVIDED, 400);
    }

    const updatedRole = await updateJobRole(id, updates);

    return Response.json(updatedRole);
  } catch (err) {
    if(err?.code===ERR.POSITION_IN_USE)return apiErrorFromResult(request,{errorCode:err.code});
    console.error('[job-roles] PATCH [id] error:', err);

    if (err.message === 'INVALID_RUBRIC') {
      return apiError(request, ERR.INVALID_RUBRIC, 400);
    }

    if (err.message === 'INVALID_MARKET_BAND') {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    if (err.message === 'JOB_ROLE_NOT_FOUND') {
      return apiError(request, ERR.JOB_ROLE_NOT_FOUND, 404);
    }

    // Violação de UNIQUE (company_id, name)
    if (err.code === '23505') {
      return apiError(request, ERR.JOB_ROLE_NAME_EXISTS, 409);
    }

    return apiError(request, ERR.INTERNAL, 500);
  }
}

/**
 * DELETE /api/admin/job-roles/[id]
 * Desativa cargo (soft delete: active = false)
 */
export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.JOB_ROLES_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const isAdmin = isSuperAdminPayload(payload);
    const id = parseInt(params.id, 10);

    if (isNaN(id)) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    // Verificar se o cargo existe e pertence à empresa
    const existingRole = await getJobRole(id);

    if (!existingRole) {
      return apiError(request, ERR.JOB_ROLE_NOT_FOUND, 404);
    }

    if (!isAdmin && existingRole.companyId !== payload.companyId) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    await deactivateJobRole(id);

    return Response.json({ success: true, id });
  } catch (err) {
    if(err?.code===ERR.POSITION_IN_USE)return apiErrorFromResult(request,{errorCode:err.code});
    console.error('[job-roles] DELETE [id] error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
