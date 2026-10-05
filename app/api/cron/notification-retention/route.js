import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { purgeOldManagerNotifications } from '../../../../lib/manager-notifications';
import { NOTIFICATION_TABLE, purgeOldNotifications } from '../../../../lib/notification-retention';

export const dynamic = 'force-dynamic';

function verifyCron(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer === secret) return true;
  const hdr = (request.headers.get('x-cron-secret') || '').trim();
  return hdr === secret;
}

/**
 * POST /api/cron/notification-retention
 * Apaga notificações in-app antigas de gestores e colaboradores (lidas / não lidas com prazos distintos).
 * Requer CRON_SECRET (Bearer ou X-Cron-Secret).
 */
export async function POST(request) {
  try {
    if (!verifyCron(request)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }

    const url = new URL(request.url);
    const readDays = parseInt(
      url.searchParams.get('readDays') || process.env.NOTIFICATION_RETENTION_READ_DAYS || '90',
      10
    );
    const unreadDays = parseInt(
      url.searchParams.get('unreadDays') || process.env.NOTIFICATION_RETENTION_UNREAD_DAYS || '180',
      10
    );

    const result = await purgeOldManagerNotifications(query, { readDays, unreadDays });
    const candidate = await purgeOldNotifications(query, NOTIFICATION_TABLE.CANDIDATE, { readDays, unreadDays });
    return NextResponse.json({ ok: true, ...result, candidate });
  } catch (err) {
    console.error('POST /api/cron/notification-retention', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
