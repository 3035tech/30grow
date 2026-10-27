import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/identity/cron-auth';
import { notifyDpPendingDocuments } from '../../../../lib/people/employee-dp.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/dp-doc-reminders
 * Remind managers + collaborators about pending DP documents (dedupe per day).
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const result = await notifyDpPendingDocuments(query);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/cron/dp-doc-reminders', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
