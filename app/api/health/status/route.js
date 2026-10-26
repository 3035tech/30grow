import { NextResponse } from 'next/server';
import { collectHealthStatus, isHealthStatusTokenValid } from '../../../../lib/health-status';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health/status
 *
 * Status agregado das dependências (Postgres, SMTP, OpenAI, réplica).
 * Pensado para Uptime Kuma.
 *
 * Auth (obrigatório) — HEALTH_STATUS_TOKEN:
 *   - Authorization: Bearer <HEALTH_STATUS_TOKEN>
 *   - X-Health-Status-Token: <HEALTH_STATUS_TOKEN>
 *   (não usar ?token= — vaza em logs/Referer)
 */
export async function GET(request) {
  const ip = clientIpFromRequest(request);
  const rl = await checkRateLimit(`health-status:${ip}`, 30, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { status: 'down', error: 'RATE_LIMIT' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  if (!String(process.env.HEALTH_STATUS_TOKEN ?? '').trim()) {
    return NextResponse.json(
      { status: 'down', error: 'HEALTH_STATUS_TOKEN_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  if (!isHealthStatusTokenValid(request)) {
    return NextResponse.json({ status: 'down', error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const report = await collectHealthStatus();
  const httpStatus = report.status === 'ok' ? 200 : 503;
  return NextResponse.json(report, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
