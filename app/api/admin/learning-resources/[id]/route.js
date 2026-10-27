import { NextResponse } from 'next/server';
import { getSessionPayload, getManagerScope, resolveScopedCompanyId, CAP, requireCapability } from '../../../../../lib/ae/require-admin.js';
import { apiError, ERR } from '../../../../../lib/api-error.js';
import {
  getLearningResource,
  updateLearningResource,
  deactivateLearningResource,
} from '../../../../../lib/development/learning-resources.js';

/**
 * GET /api/admin/learning-resources/[id] — get resource
 * PATCH /api/admin/learning-resources/[id] — update resource
 * DELETE /api/admin/learning-resources/[id] — deactivate resource
 */


export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.LEARNING_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const { id } = params;
    const resourceId = Number(id);
    if (!resourceId || resourceId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const resource = await getLearningResource(null, { companyId, resourceId });
    if (!resource) {
      return apiError(request, ERR.NOT_FOUND, 404);
    }

    return NextResponse.json({ ok: true, resource }, { status: 200 });
  } catch (err) {
    console.error('GET /api/admin/learning-resources/[id] error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.LEARNING_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError(request, ERR.INVALID_JSON, 400);
    }

    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const { id } = params;
    const resourceId = Number(id);
    if (!resourceId || resourceId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await updateLearningResource(null, {
      companyId,
      resourceId,
      title: body.title,
      description: body.description,
      theme: body.theme,
      resourceType: body.resourceType,
      url: body.url,
      durationHours: body.durationHours,
      active: body.active,
    });

    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      if (result.errorCode === 'TITLE_REQUIRED') {
        return apiError(request, ERR.TITLE_REQUIRED, 400);
      }
      return apiError(request, ERR.UPDATE_FAILED, 500);
    }

    return NextResponse.json({ ok: true, resource: result.resource }, { status: 200 });
  } catch (err) {
    console.error('PATCH /api/admin/learning-resources/[id] error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function DELETE(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.LEARNING_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = resolveScopedCompanyId(scope, new URL(request.url).searchParams.get('companyId'));
    if (!companyId) return apiError(request, ERR.COMPANY_REQUIRED, 400);

    const { id } = params;
    const resourceId = Number(id);
    if (!resourceId || resourceId <= 0) {
      return apiError(request, ERR.INVALID_ID, 400);
    }

    const result = await deactivateLearningResource(null, { companyId, resourceId });
    if (!result.ok) {
      if (result.errorCode === 'NOT_FOUND') {
        return apiError(request, ERR.NOT_FOUND, 404);
      }
      return apiError(request, ERR.DELETE_FAILED, 500);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('DELETE /api/admin/learning-resources/[id] error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
