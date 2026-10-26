import { NextResponse } from 'next/server';
import { queryRead } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit';
import {
  JOB_ATTR_COOKIE,
  decodeAttributionCookie,
} from '../../../../lib/recruiting/job-attribution';
import { FUNNEL_EVENT_TYPES, recordJobFunnelEvent } from '../../../../lib/recruiting/job-funnel';

/**
 * POST /api/public/job-funnel
 * Body: { eventType: 'job_view'|'apply_start', vacancyId: number }
 * Atribuição vem do cookie httpOnly (sem PII no body).
 */
export async function POST(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`job-funnel:${ip}`, 120, 10 * 60 * 1000);
  if (!rl.ok) {
    return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
  }

  const body = await request.json().catch(() => ({}));
  const eventType = String(body.eventType || '').trim();
  const vacancyId = Number(body.vacancyId);
  if (!FUNNEL_EVENT_TYPES.has(eventType) || (eventType !== 'job_view' && eventType !== 'apply_start')) {
    return apiError(request, ERR.INVALID_DATA, 400);
  }
  if (!Number.isFinite(vacancyId) || vacancyId <= 0) {
    return apiError(request, ERR.INVALID_VACANCY, 400);
  }

  const vac = await queryRead(
    `SELECT v.id, v.company_id AS "companyId"
     FROM vacancies v
     JOIN companies c ON c.id = v.company_id
     WHERE v.id = $1
       AND v.deleted = FALSE
       AND c.deleted = FALSE
       AND c.active = TRUE
       AND v.public_page_enabled = TRUE
     LIMIT 1`,
    [vacancyId]
  );
  if (vac.rowCount === 0) {
    // Não revelar existência de vacancyId (anti-enumeração).
    return NextResponse.json({ ok: true, skipped: true });
  }

  const attr = decodeAttributionCookie(request.cookies.get(JOB_ATTR_COOKIE)?.value);
  const result = await recordJobFunnelEvent({
    companyId: vac.rows[0].companyId,
    vacancyId,
    eventType,
    sessionId: attr?.sessionId || null,
    source: attr?.source || null,
    medium: attr?.medium || null,
    campaign: attr?.campaign || null,
    referralCode: attr?.ref || null,
  });

  return NextResponse.json({ ok: true, skipped: Boolean(result.skipped) });
}
