/**
 * B-1107 — Relatórios agendados de Analytics
 * POST /api/cron/analytics-report
 * 
 * Cron job semanal/mensal para enviar digest de métricas por email
 * Authorization: Bearer {CRON_SECRET} ou header X-Cron-Secret
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { verifyCronRequest } from '../../../../lib/cron-auth.js';
import { runScheduledAnalyticsReports } from '../../../../lib/analytics-scheduled-reports.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/analytics-report
 * Query params:
 * - email=0 : desabilita envio de email (default: enabled)
 * - locale=en : idioma do relatório (default: pt-BR)
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const url = new URL(request.url);
    const sendEmail = url.searchParams.get('email') !== '0';
    const locale = url.searchParams.get('locale') || 'pt-BR';
    const frequency = url.searchParams.get('frequency') || 'weekly';
    const force = url.searchParams.get('force') === '1';

    const result = await runScheduledAnalyticsReports(query, {
      sendEmail,
      locale,
      frequency,
      force,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[POST /api/cron/analytics-report]', err);
    return apiError(request, ERR.SERVER_ERROR, 500);
  }
}
