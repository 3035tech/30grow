import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifyCronRequest } from '../../../../lib/identity/cron-auth';
import { runTimeClockOpenDayReminders } from '../../../../lib/people/time-clock-open-day-reminders';

export const dynamic = 'force-dynamic';

/** POST /api/cron/time-clock-open-day-reminders — reminders for the previous local day. */
export async function POST(request) {
  try {
    if (!verifyCronRequest(request)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const sendEmail = new URL(request.url).searchParams.get('email') !== '0';
    const result = await runTimeClockOpenDayReminders(query, { sendEmail });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('POST /api/cron/time-clock-open-day-reminders', error);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
