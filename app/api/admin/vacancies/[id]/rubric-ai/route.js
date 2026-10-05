import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/auth';
import {
  CAP,
  getManagerScope,
  requireCapability,
  verifySessionWithCapabilities,
} from '../../../../../../lib/ae/require-admin';
import { apiError, ERR, httpStatusForError } from '../../../../../../lib/api-error';
import { queryRead } from '../../../../../../lib/db';
import { isRubricContextFilledEnough } from '../../../../../../lib/rubric-prompt';
import {
  isRubricAiConfigured,
  suggestRubricContextFromVacancy,
  suggestRubricWeightsFromContext,
} from '../../../../../../lib/rubric-ai';
import { normalizeLocale } from '../../../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit';

async function loadVacancyScoped(vacancyId, { isAdmin, companyId }) {
  const r = await queryRead(
    `SELECT
       v.id,
       v.company_id AS "companyId",
       v.title,
       v.description,
       v.salary_min AS "salaryMin",
       v.salary_max AS "salaryMax",
       v.target_date AS "targetDate",
       v.employment_type AS "employmentType",
       v.status
     FROM vacancies v
     WHERE v.id = $1 AND v.deleted = FALSE
       ${!isAdmin ? 'AND v.company_id = $2' : ''}
     LIMIT 1`,
    !isAdmin ? [vacancyId, companyId] : [vacancyId]
  );
  return r.rows[0] || null;
}

/**
 * POST /api/admin/vacancies/[id]/rubric-ai
 * body: { action: 'suggestContext' | 'suggestWeights', context?: string, locale?: string }
 */
export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  if (!isRubricAiConfigured()) {
    return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, 503);
  }

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`rubric-ai:${payload.userId || ip}`, 20, 15 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const vacancyId = params?.id;
  if (!vacancyId) return apiError(request, ERR.INVALID_VACANCY, 400);

  const vacancy = await loadVacancyScoped(vacancyId, scope);
  if (!vacancy) return apiError(request, ERR.NOT_FOUND, 404);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');
  const usage = { companyId: vacancy.companyId, userId: payload.userId };

  try {
    if (action === 'suggestContext') {
      const out = await suggestRubricContextFromVacancy(vacancy, locale, usage);
      return NextResponse.json({ ok: true, action, context: out.context, model: out.model });
    }

    if (action === 'suggestWeights') {
      const context = String(body.context || '').trim();
      if (!isRubricContextFilledEnough(context)) {
        return apiError(request, ERR.RUBRIC_AI_NEED_CONTEXT, 400);
      }
      const out = await suggestRubricWeightsFromContext(context, locale, usage);
      return NextResponse.json({
        ok: true,
        action,
        raw: out.raw,
        weights: out.weights,
        notes: out.notes || null,
        model: out.model,
      });
    }

    return apiError(request, ERR.INVALID_ACTION, 400);
  } catch (e) {
    const code = e?.code || 'RUBRIC_AI_FAILED';
    if (code === 'RUBRIC_AI_PARSE') {
      return NextResponse.json(
        { error: 'RUBRIC_AI_PARSE', errorCode: ERR.RUBRIC_AI_PARSE, raw: e.raw || null },
        { status: 422 }
      );
    }
    return apiError(request, code, httpStatusForError(code, 502));
  }
}
