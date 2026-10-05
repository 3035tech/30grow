import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/cron-auth';
import { notifyLmsOverdueEnrollments } from '../../../../lib/lms.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/lms-overdue-notifications
 * Notifies company managers about overdue LMS enrollments (dedupe per enrollment+day).
 */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const url = new URL(request.url);
    const withinPastDays = parseInt(url.searchParams.get('withinPastDays') || '30', 10);
    const result = await notifyLmsOverdueEnrollments(query, { withinPastDays });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/cron/lms-overdue-notifications', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
