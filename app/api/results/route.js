import { isSuperAdminPayload } from '../../../lib/permissions.js';
import { NextResponse } from 'next/server';
import { queryRead } from '../../../lib/db';
import { COOKIE_NAME } from '../../../lib/auth';
import { cookies } from 'next/headers';
import { checkRateLimit, clientIpFromRequest } from '../../../lib/rate-limit';
import { apiError, ERR } from '../../../lib/api-error';
import { JOB_ATTR_COOKIE } from '../../../lib/job-attribution';
import { normalizeAssessmentTelemetry, submitAssessmentResult } from '../../../lib/assessment-submit';
import { verifySessionWithCapabilities } from '../../../lib/session';


// POST /api/results — salva resultado de um candidato (com área)
export async function POST(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`results:${ip}`, 40, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const body = await request.json().catch(() => ({}));
    const { name, email, areaKey, consent, answers, companyToken, vacancyToken, inviteToken } = body;
    const { fillDurationMs, copyEventCount } = normalizeAssessmentTelemetry(body);
    const attributionCookieValue = await (await cookies()).get(JOB_ATTR_COOKIE)?.value;

    const result = await submitAssessmentResult({
      name,
      email,
      areaKey,
      consent,
      answers,
      companyToken,
      vacancyToken,
      inviteToken,
      profileBody: body,
      attributionCookieValue,
      fillDurationMs,
      copyEventCount,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode, result.status || 400, result.values || {});
    }

    return NextResponse.json(
      {
        ok: true,
        candidateId: result.candidateId,
        assessmentId: result.assessmentId,
        createdAt: result.createdAt,
        ...(result.vacancyId != null ? { vacancyId: result.vacancyId } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Erro ao salvar resultado:', { code: error?.code || 'UNKNOWN' });
    return apiError(request, ERR.INTERNAL, 500);
  }
}

// GET /api/results — legado: tabela `results` (global por nome). Preferir dados do dashboard via assessments.
export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);

  if (!isSuperAdminPayload(payload)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  try {
    const result = await queryRead(
      `SELECT id, name, top_type AS "topType", scores, created_at AS "createdAt"
       FROM results
       ORDER BY created_at DESC`
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar resultados:', { code: error?.code || 'UNKNOWN' });
    return apiError(request, ERR.INTERNAL, 500);
  }
}
