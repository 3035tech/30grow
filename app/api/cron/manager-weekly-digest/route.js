import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/cron-auth';
import { runManagerWeeklyDigest } from '../../../../lib/manager-weekly-digest';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/manager-weekly-digest
 * Resumo semanal: retention_watch recentes + 1:1 em atraso (notif in-app + e-mail opcional).
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const url = new URL(request.url);
    const retentionDays = parseInt(url.searchParams.get('retentionDays') || '7', 10);
    const staleOneOnOneDays = parseInt(url.searchParams.get('staleDays') || '21', 10);
    const sendEmail = url.searchParams.get('email') !== '0';

    const result = await runManagerWeeklyDigest(query, {
      retentionDays,
      staleOneOnOneDays,
      sendEmail,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/cron/manager-weekly-digest', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
