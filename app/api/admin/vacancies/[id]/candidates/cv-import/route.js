import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../../../lib/api-error.js';
import { audit } from '../../../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../../../lib/identity/rate-limit.js';
import { logger } from '../../../../../../../lib/monitoring.js';
import { CV_PDF_MAX_BYTES, isCvStorageConfigured } from '../../../../../../../lib/recruiting/candidate-cv.js';
import { analyzeNewCandidateCv, createCandidateFromCv } from '../../../../../../../lib/recruiting/candidate-cv-create.js';
import { loadVacancyForActor } from '../../../../../../../lib/recruiting/vacancies-admin.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

function safeCauseCode(error) {
  const code = String(error?.code || '');
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
}

function logHandledImportFailure(diagnostics, errorCode) {
  logger.warn('Candidate CV import returned an error', {
    mode: diagnostics.mode,
    stage: diagnostics.stage,
    errorCode,
  });
}

async function handleCandidateCvImport({ request, payload, scope, params }, diagnostics) {
  diagnostics.stage = 'validate_vacancy';
  const vacancyId = Number(params?.id);
  if (!Number.isSafeInteger(vacancyId) || vacancyId <= 0) return apiError(request, ERR.INVALID_VACANCY, 400);

  diagnostics.stage = 'load_vacancy';
  const loaded = await loadVacancyForActor({ vacancyId, isAdmin: scope.isAdmin, companyId: scope.companyId });
  if (!loaded.ok) {
    logHandledImportFailure(diagnostics, loaded.errorCode || ERR.INVALID_VACANCY);
    return apiErrorFromResult(request, loaded);
  }

  diagnostics.stage = 'check_storage';
  if (!isCvStorageConfigured()) {
    logHandledImportFailure(diagnostics, ERR.STORAGE_NOT_CONFIGURED);
    return apiError(request, ERR.STORAGE_NOT_CONFIGURED, 503);
  }

  diagnostics.stage = 'read_form';
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const mode = form?.get('mode');
  diagnostics.mode = mode === 'analyze' || mode === 'create' ? mode : 'invalid';
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    logHandledImportFailure(diagnostics, ERR.INVALID_CV_FILE_TYPE);
    return apiError(request, ERR.INVALID_CV_FILE_TYPE, 400);
  }
  if (file.size <= 0 || file.size > CV_PDF_MAX_BYTES) {
    logHandledImportFailure(diagnostics, ERR.INVALID_CV_FILE_SIZE);
    return apiError(request, ERR.INVALID_CV_FILE_SIZE, 400);
  }
  if (mode !== 'analyze' && mode !== 'create') {
    logHandledImportFailure(diagnostics, ERR.INVALID_DATA);
    return apiError(request, ERR.INVALID_DATA, 400);
  }

  diagnostics.stage = 'rate_limit';
  const rate = await checkRateLimit(`cv-create:${mode}:${payload.userId}`, mode === 'analyze' ? 6 : 15, 60_000);
  if (!rate.ok) {
    logHandledImportFailure(diagnostics, ERR.RATE_LIMIT);
    return apiError(request, ERR.RATE_LIMIT, 429);
  }

  diagnostics.stage = 'read_file';
  const buffer = Buffer.from(await file.arrayBuffer());
  const common = { buffer, companyId: loaded.vacancy.companyId, vacancyId, userId: payload.userId };

  try {
    if (mode === 'analyze') {
      diagnostics.stage = 'analyze';
      const result = await analyzeNewCandidateCv({ ...common, locale: String(form.get('locale') || 'pt-BR') });
      if (!result.ok) {
        logHandledImportFailure(diagnostics, result.errorCode || ERR.RUBRIC_AI_FAILED);
        return apiErrorFromResult(request, result);
      }
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }

    diagnostics.stage = 'parse_fields';
    let input;
    try {
      input = JSON.parse(String(form.get('fields') || '{}'));
    } catch {
      logHandledImportFailure(diagnostics, ERR.INVALID_DATA);
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    diagnostics.stage = 'create_candidate';
    const result = await createCandidateFromCv({ ...common, token: String(form.get('token') || ''), input });
    if (!result.ok) {
      logHandledImportFailure(diagnostics, result.errorCode || ERR.RUBRIC_AI_FAILED);
      return apiErrorFromResult(request, result);
    }

    diagnostics.stage = 'audit';
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
    logger.error('Candidate CV import failed', {
      mode: diagnostics.mode,
      stage: diagnostics.stage,
      errorCode: code,
      causeCode: safeCauseCode(error),
    });
    return apiError(request, code, httpStatusForError(code, 500));
  }
}

export const POST = withAdminApi(
  { cap: CAP.VACANCIES_MANAGE, companyFrom: 'none', requireCompany: false, logLabel: 'candidate cv create' },
  async (context) => {
    const diagnostics = { mode: 'unknown', stage: 'start' };
    try {
      return await handleCandidateCvImport(context, diagnostics);
    } catch (error) {
      logger.error('Candidate CV import request failed', {
        mode: diagnostics.mode,
        stage: diagnostics.stage,
        errorCode: ERR.INTERNAL,
        causeCode: safeCauseCode(error),
      });
      return apiError(context.request, ERR.INTERNAL, 500);
    }
  },
);
