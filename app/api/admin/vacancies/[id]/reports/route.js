import { runtimeAppUrl } from '../../../../../../lib/app-url.js';
import { NextResponse } from 'next/server';
import { verifySessionWithCapabilities } from '../../../../../../lib/user-capabilities';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/auth';
import {
  createReportShare,
  listReportShares,
  loadVacancyReportSource,
} from '../../../../../../lib/vacancy-report';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { CAP, isAdminRole, requireCapability } from '../../../../../../lib/permissions';
import { loadCompanyInternalNucleus } from '../../../../../../lib/people/company-nucleus.js';
import { buildShortlistCompositionRisks } from '../../../../../../lib/shortlist-composition-risks.js';
import { queryRead } from '../../../../../../lib/db.js';
import { normalizeLocale } from '../../../../../../lib/i18n.js';


function appOrigin(request) {
  const env = String(runtimeAppUrl() || '').replace(/\/$/, '');
  if (env) return env;
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

export async function GET(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isAdminRole(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const { searchParams } = new URL(request.url);
    if (searchParams.get('compositionRisks') === '1') {
      const source = await loadVacancyReportSource(vacancyId, { isAdmin, companyId });
      if (!source) return apiError(request, ERR.NOT_FOUND, 404);
      const locale = normalizeLocale(searchParams.get('locale'));
      const rawIds = String(searchParams.get('candidateIds') || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      const idSet = new Set(rawIds);
      const shortlist = source.people
        .filter((p) => idSet.has(p.candidateId))
        .map((p) => ({
          candidateId: p.candidateId,
          name: p.name,
          topType: p.topType,
        }));
      const nucleus = await loadCompanyInternalNucleus(queryRead, {
        companyId: source.vacancy.companyId,
      });
      const risks = buildShortlistCompositionRisks({
        locale,
        shortlist,
        nucleus: nucleus.map((n) => ({ id: n.id, name: n.name, topType: n.topType })),
      });
      return NextResponse.json({ vacancyId: Number(vacancyId), ...risks });
    }

    if (searchParams.get('candidates') === '1') {
      const source = await loadVacancyReportSource(vacancyId, { isAdmin, companyId });
      if (!source) return apiError(request, ERR.NOT_FOUND, 404);
      return NextResponse.json({
        vacancyId: Number(vacancyId),
        vacancy: {
          id: source.vacancy.id,
          title: source.vacancy.title,
          companyName: source.vacancy.companyName,
          positionsCount: source.vacancy.positionsCount,
          hasDescription: Boolean(source.vacancy.description && String(source.vacancy.description).trim()),
          clientReportShowSalary: Boolean(source.vacancy.clientReportShowSalary),
        },
        rubricSummary: {
          hasRubric: Object.keys(source.rubricWeights || {}).length > 0,
          weightedTypes: Object.keys(source.rubricWeights || {})
            .map((k) => ({ type: Number(k), weight: source.rubricWeights[k] }))
            .sort((a, b) => b.weight - a.weight || a.type - b.type),
          hasNotes: Boolean(source.rubricNotes),
        },
        candidates: source.people.map((p) => ({
          candidateId: p.candidateId,
          name: p.name,
          topType: p.topType,
          pipelineStage: p.pipelineStage,
          recommendation: p.recommendation,
          vacancyFitScore010: p.vacancyFitScore010,
          vacancyFitLabel: p.vacancyFitLabel,
          city: p.city,
          state: p.state,
          salaryExpectation: p.salaryExpectation,
          availability: p.availability,
          hasMotivators: Array.isArray(p.motivatorsTop) && p.motivatorsTop.length > 0,
          excludedFromClient: p.recommendation === 'exclude',
        })),
      });
    }

    const reports = await listReportShares(vacancyId, { isAdmin, companyId });
    const origin = appOrigin(request);
    return NextResponse.json({
      vacancyId: Number(vacancyId),
      reports: reports.map((r) => ({
        ...r,
        url: origin ? `${origin}/r/${r.token}` : `/r/${r.token}`,
      })),
    });
  } catch (e) {
    console.error('[vacancy-reports GET]', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request, props) {
  const params = await props.params;
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(session);
    if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

    const isAdmin = isAdminRole(payload);
    const companyId = payload?.companyId ?? null;
    if (!isAdmin && !companyId) return apiError(request, ERR.UNAUTHORIZED, 401);

    const vacancyId = params?.id;
    if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

    const body = await request.json().catch(() => ({}));
    const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    const expiresInDays = body.expiresInDays;
    const executiveNote = body.executiveNote;
    const candidateOverrides =
      body.candidateOverrides && typeof body.candidateOverrides === 'object' ? body.candidateOverrides : {};

    const source = await loadVacancyReportSource(vacancyId, { isAdmin, companyId });
    if (!source) return apiError(request, ERR.NOT_FOUND, 404);

    const row = await createReportShare({
      vacancyId: Number(vacancyId),
      companyId: source.vacancy.companyId,
      userId: payload?.userId ?? null,
      candidateIds,
      expiresInDays,
      executiveNote,
      candidateOverrides,
      isAdmin,
      sessionCompanyId: companyId,
    });

    const origin = appOrigin(request);
    const url = origin ? `${origin}/r/${row.token}` : `/r/${row.token}`;

    return NextResponse.json(
      {
        id: row.id,
        token: row.token,
        url,
        expiresAt: row.expiresAt,
        candidateCount: Array.isArray(row.snapshot?.candidates) ? row.snapshot.candidates.length : null,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e?.code === 'NO_CANDIDATES') return apiError(request, ERR.INCOMPLETE_DATA, 400);
    if (e?.code === 'NOTE_TOO_SHORT') return apiError(request, ERR.REPORT_NOTE_TOO_SHORT, 400);
    if (e?.code === 'NOT_FOUND') return apiError(request, ERR.NOT_FOUND, 404);
    console.error('[vacancy-reports POST]', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
