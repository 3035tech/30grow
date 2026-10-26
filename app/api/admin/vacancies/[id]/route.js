import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../lib/api-error';
import { auditFromRequest } from '../../../../../lib/audit';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  requireCapability,
} from '../../../../../lib/ae/require-admin';
import {
  assertVacancyAccess,
  attachVacancyActiveToken,
  getVacancyById,
  getVacancyRubric,
  softDeleteVacancy,
  updateVacancy,
} from '../../../../../lib/recruiting/vacancies-admin';

export async function GET(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  if (!id) return apiError(request, ERR.INVALID_VACANCY, 400);

  const v = await getVacancyById(id, scope.isAdmin ? {} : { companyId: scope.companyId });
  if (!v) return apiError(request, ERR.NOT_FOUND, 404);
  if (!assertVacancyAccess(v, scope)) return apiError(request, ERR.NOT_FOUND, 404);

  const rubric = await getVacancyRubric(id);
  return NextResponse.json({ ...(await attachVacancyActiveToken(v)), ...rubric });
}

export async function PATCH(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  if (!id) return apiError(request, ERR.INVALID_VACANCY, 400);

  const current = await getVacancyById(id, scope.isAdmin ? {} : { companyId: scope.companyId });
  if (!current) return apiError(request, ERR.NOT_FOUND, 404);
  if (!assertVacancyAccess(current, scope)) return apiError(request, ERR.NOT_FOUND, 404);

  const body = await request.json().catch(() => ({}));
  const result = await updateVacancy({ vacancyId: id, current, body });
  if (!result.ok) {
    const status = result.errorCode === ERR.NOT_FOUND ? 404 : 400;
    return apiError(request, result.errorCode || ERR.INVALID_DATA, status);
  }
  await auditFromRequest(request, {
    actorUserId: payload?.userId || payload?.id || null,
    companyId: current.companyId,
    action: 'recruiting.vacancy.updated',
    targetType: 'vacancy',
    targetId: id,
    metadata: { ownerUpdated: body.ownerUserId !== undefined },
  });
  if (body.ownerUserId !== undefined) {
    await auditFromRequest(request, {
      actorUserId: payload?.userId || payload?.id || null,
      companyId: current.companyId,
      action: 'recruiting.vacancy.owner_updated',
      targetType: 'vacancy',
      targetId: id,
      metadata: { ownerUserId: result.vacancy.ownerUserId || null },
    });
  }

  return NextResponse.json(result.vacancy);
}

export async function DELETE(request, props) {
  const params = await props.params;
  const payload = await getSessionPayload();
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const id = params?.id;
  if (!id) return apiError(request, ERR.INVALID_VACANCY, 400);

  const beforeDelete = await getVacancyById(id, scope.isAdmin ? {} : { companyId: scope.companyId });
  if (!beforeDelete) return apiError(request, ERR.NOT_FOUND, 404);
  if (!assertVacancyAccess(beforeDelete, scope)) return apiError(request, ERR.NOT_FOUND, 404);

  const result = await softDeleteVacancy({ vacancyId: id, beforeDelete });
  if (!result.ok) return apiError(request, result.errorCode || ERR.NOT_FOUND, 404);

  await auditFromRequest(request, {
    actorUserId: payload?.userId || payload?.id || null,
    companyId: beforeDelete.companyId,
    action: 'recruiting.vacancy.soft_deleted',
    targetType: 'vacancy',
    targetId: id,
  });

  return NextResponse.json({ ok: true });
}
