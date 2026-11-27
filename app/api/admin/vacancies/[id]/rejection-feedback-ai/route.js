import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../../../lib/identity/auth';
import {
  CAP,
  getManagerScope,
  requireCapability,
  verifySessionWithCapabilities,
} from '../../../../../../lib/ae/require-admin';
import { apiError, ERR, httpStatusForError } from '../../../../../../lib/api-error';
import { queryRead } from '../../../../../../lib/db';
import { isOpenAiConfigured } from '../../../../../../lib/openai-chat';
import { generateCandidateRejectionFeedback } from '../../../../../../lib/recruiting/rejection-feedback-ai';
import { AI_FEATURE } from '../../../../../../lib/ai-usage';
import { normalizeLocale } from '../../../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit';

const TONES = new Set(['warm', 'direct', 'detailed']);

/** POST /api/admin/vacancies/:id/rejection-feedback-ai */
export async function POST(request, props) {
  const params = await props.params;
  const cookieStore = await cookies();
  const payload = await verifySessionWithCapabilities(cookieStore.get(COOKIE_NAME)?.value);
  if (!requireCapability(payload, CAP.VACANCIES_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);

  const scope = getManagerScope(payload);
  if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

  const vacancyId = Number(params?.id);
  if (!Number.isSafeInteger(vacancyId) || vacancyId <= 0) return apiError(request, ERR.INVALID_VACANCY, 400);
  const vacancy = await queryRead(
    `SELECT id, company_id AS "companyId" FROM vacancies
     WHERE id=$1 AND deleted=FALSE ${scope.isAdmin ? '' : 'AND company_id=$2'} LIMIT 1`,
    scope.isAdmin ? [vacancyId] : [vacancyId, scope.companyId]
  );
  if (!vacancy.rowCount) return apiError(request, ERR.NOT_FOUND, 404);

  if (!isOpenAiConfigured()) return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, 503);
  const body = await request.json().catch(() => ({}));
  const notes = String(body.notes || '').trim();
  const tone = String(body.tone || 'warm');
  if (notes.length < 8 || notes.length > 1800 || !TONES.has(tone)) {
    return apiError(request, ERR.INVALID_DATA, 400);
  }

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`rejection-feedback-ai:${payload.userId || ip}`, 12, 15 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const locale = normalizeLocale(body.locale || payload.locale || 'pt-BR');
  try {
    const draft = await generateCandidateRejectionFeedback({
      notes,
      tone,
      locale,
      usage: { companyId: vacancy.rows[0].companyId, userId: payload.userId },
    });
    return NextResponse.json({ ok: true, draft, feature: AI_FEATURE.CANDIDATE_REJECTION_FEEDBACK });
  } catch (error) {
    const code = error?.code || 'RUBRIC_AI_FAILED';
    const safeCode = code === 'INVALID_REJECTION_FEEDBACK_INPUT' ? ERR.INVALID_DATA : code;
    return apiError(request, safeCode, httpStatusForError(safeCode, 502));
  }
}
