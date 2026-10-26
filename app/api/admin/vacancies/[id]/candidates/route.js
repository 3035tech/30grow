import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../../../lib/api-error';
import {
  CAP,
  getSessionPayload,
  getManagerScope,
  requireCapability,
} from '../../../../../../lib/ae/require-admin';
import {
  linkVacancyCandidate,
  listVacancyCandidates,
  loadVacancyForActor,
} from '../../../../../../lib/recruiting/vacancies-admin';

function actorErrorStatus(errorCode) {
  if (errorCode === 'VACANCY_NOT_FOUND' || errorCode === 'NOT_FOUND') return 404;
  return 401;
}

/** Lista candidatos pré-cadastrados na vaga + status eneagrama e Motivadores. */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const loaded = await loadVacancyForActor({
      vacancyId,
      isAdmin: scope.isAdmin,
      companyId: scope.companyId,
    });
    if (!loaded.ok) {
      return apiError(request, loaded.errorCode || 'UNAUTHORIZED', actorErrorStatus(loaded.errorCode));
    }

    const list = await listVacancyCandidates(vacancyId, {
      page: new URL(request.url).searchParams.get('page') || 1,
      pageSize: new URL(request.url).searchParams.get('pageSize') || 300,
    });
    return NextResponse.json(list);
  } catch (error) {
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** Cadastra candidato (nome+email) na vaga após a entrevista. */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const loaded = await loadVacancyForActor({
      vacancyId,
      isAdmin: scope.isAdmin,
      companyId: scope.companyId,
    });
    if (!loaded.ok) {
      return apiError(request, loaded.errorCode || 'UNAUTHORIZED', actorErrorStatus(loaded.errorCode));
    }

    const body = await request.json().catch(() => ({}));
    const result = await linkVacancyCandidate({
      vacancy: loaded.vacancy,
      body,
      createdByUserId: payload?.userId,
    });
    if (!result.ok) {
      return apiError(request, result.errorCode || 'INTERNAL', result.status || 400);
    }

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error(error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
