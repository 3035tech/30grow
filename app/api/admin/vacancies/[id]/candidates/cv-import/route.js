import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../../../lib/identity/rate-limit.js';
import { CV_PDF_MAX_BYTES, isCvStorageConfigured } from '../../../../../../../lib/recruiting/candidate-cv.js';
import { analyzeNewCandidateCv, createCandidateFromCv } from '../../../../../../../lib/recruiting/candidate-cv-create.js';
import { loadVacancyForActor } from '../../../../../../../lib/recruiting/vacancies-admin.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, companyFrom: 'none', requireCompany: false, logLabel: 'candidate cv create' },
  async ({ request, payload, scope, params }) => {
    const vacancyId = Number(params?.id);
    if (!Number.isSafeInteger(vacancyId) || vacancyId <= 0) return apiError(request, ERR.INVALID_VACANCY, 400);
    const loaded = await loadVacancyForActor({ vacancyId, isAdmin: scope.isAdmin, companyId: scope.companyId });
    if (!loaded.ok) return apiErrorFromResult(request, loaded);
    if (!isCvStorageConfigured()) return apiError(request, ERR.STORAGE_NOT_CONFIGURED, 503);

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    const mode = form?.get('mode');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function')
      return apiError(request, ERR.INVALID_CV_FILE_TYPE, 400);
    if (file.size <= 0 || file.size > CV_PDF_MAX_BYTES)
      return apiError(request, ERR.INVALID_CV_FILE_SIZE, 400);
    if (mode !== 'analyze' && mode !== 'create') return apiError(request, ERR.INVALID_DATA, 400);
    const rate = await checkRateLimit(`cv-create:${mode}:${payload.userId}`, mode === 'analyze' ? 6 : 15, 60_000);
    if (!rate.ok) return apiError(request, ERR.RATE_LIMIT, 429);
    const buffer = Buffer.from(await file.arrayBuffer());
    const common = { buffer, companyId: loaded.vacancy.companyId, vacancyId, userId: payload.userId };

    try {
      if (mode === 'analyze') {
        const result = await analyzeNewCandidateCv({ ...common, locale: String(form.get('locale') || 'pt-BR') });
        if (!result.ok) return apiErrorFromResult(request, result);
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      let input;
      try {
        input = JSON.parse(String(form.get('fields') || '{}'));
      } catch {
        return apiError(request, ERR.INVALID_DATA, 400);
      }
      const result = await createCandidateFromCv({ ...common, token: String(form.get('token') || ''), input });
      if (!result.ok) return apiErrorFromResult(request, result);
      await audit({
        actorUserId: payload.userId,
        companyId: result.companyId,
        action: 'candidate.created_from_cv',
        targetType: 'candidate',
        targetId: result.candidateId,
        metadata: { vacancyId, fields: Object.keys(input), source: 'cv_ai_reviewed' },
      });
      return NextResponse.json({ ok: true, candidateId: result.candidateId }, { status: 201 });
    } catch (error) {
      const code = Object.values(ERR).includes(error?.code) ? error.code : ERR.RUBRIC_AI_FAILED;
      return apiError(request, code, httpStatusForError(code, 500));
    }
  },
);
