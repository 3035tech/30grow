import { NextResponse } from 'next/server';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/cron-auth';
import { refreshHourBankCheckpoints } from '../../../../lib/people/hour-bank-checkpoints.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/hour-bank-checkpoints
 * Grava o saldo do banco de horas de ~1 mês atrás por pessoa (migration 148), para o
 * cálculo não reprocessar desde o início do banco. Diário; idempotente.
 * Requer CRON_SECRET (Bearer ou X-Cron-Secret).
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const result = await refreshHourBankCheckpoints();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/cron/hour-bank-checkpoints', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
