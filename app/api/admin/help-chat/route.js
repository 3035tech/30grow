import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth';
import {
  CAP,
  requireCapability,
  verifySessionWithCapabilities,
} from '../../../../lib/ae/require-admin';
import { apiError, ERR } from '../../../../lib/api-error';
import { normalizeLocale } from '../../../../lib/i18n';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';
import { answerHelpQuestion } from '../../../../lib/help-assistant';

/**
 * POST /api/admin/help-chat
 * body: { question, locale?, history? }
 */
export async function POST(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!requireCapability(payload, CAP.HELP_VIEW)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`help-chat:${payload.userId || ip}`, 40, 60 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));
  const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');
  const question = String(body.question || '').trim();
  const history = Array.isArray(body.history) ? body.history : [];
  const activeTab = body.activeTab != null ? String(body.activeTab).trim().slice(0, 64) : null;
  const activeSection =
    body.activeSection != null ? String(body.activeSection).trim().slice(0, 64) : null;

  try {
    const out = await answerHelpQuestion({
      question,
      locale,
      history,
      activeTab,
      activeSection,
      usage: { companyId: payload.companyId ?? null, userId: payload.userId },
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const code = e?.code || 'HELP_ASSIST_FAILED';
    if (code === 'HELP_ASSIST_EMPTY') return apiError(request, ERR.INVALID_ACTION, 400);
    console.error('help-chat', e);
    return apiError(request, code === 'HELP_ASSIST_AI_FAILED' ? 'RUBRIC_AI_FAILED' : 'INTERNAL', 502);
  }
}
