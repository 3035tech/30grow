import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../lib/auth';
import {
  CAP,
  requireCapability,
  verifySessionWithCapabilities,
} from '../../../../../lib/ae/require-admin';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error';
import { isOpenAiConfigured } from '../../../../../lib/openai-chat';
import { normalizeLocale } from '../../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit';
import { suggestVacancyDescriptionAi } from '../../../../../lib/vacancy-assist-ai';

/**
 * POST /api/admin/vacancies/assist-ai
 * Sem vacancy id — rascunho de descrição no create.
 * body: { action: 'vacancyDescription', title, employmentType, salaryMin, salaryMax, description?, mode?, locale? }
 */
export async function POST(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  if (!isOpenAiConfigured()) {
    return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, 503);
  }

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`assist-ai-draft:${payload.userId || ip}`, 20, 15 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');

  if (action !== 'vacancyDescription') {
    return apiError(request, ERR.INVALID_ACTION, 400);
  }

  const title = String(body.title || '').trim();
  if (!title) return apiError(request, ERR.TITLE_REQUIRED, 400);

  try {
    const out = await suggestVacancyDescriptionAi({
      vacancy: {
        title,
        employmentType: body.employmentType || null,
        salaryMin: body.salaryMin || null,
        salaryMax: body.salaryMax || null,
        description: body.description || '',
        rubricNotes: body.rubricNotes || '',
      },
      locale,
      mode: body.mode || 'auto',
      usage: { companyId: payload.companyId ?? null, userId: payload.userId },
    });
    return NextResponse.json({
      ok: true,
      action,
      description: out.description,
      mode: out.mode,
      model: out.model,
    });
  } catch (e) {
    const code = e?.code || 'RUBRIC_AI_FAILED';
    if (code === 'ASSIST_AI_DESC_SHORT') {
      return NextResponse.json({ error: code, errorCode: code, raw: e.raw || null }, { status: 422 });
    }
    return apiError(request, code, httpStatusForError(code, 502));
  }
}
