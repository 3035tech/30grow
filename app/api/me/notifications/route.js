import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth';
import { query, queryRead } from '../../../../lib/db';
import { apiError, ERR } from '../../../../lib/api-error';
import { verifySessionWithCapabilities } from '../../../../lib/session';
import {
  countUnreadNotificationsForUser,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../../../lib/manager-notifications';
import { notificationHref } from '../../../../lib/manager-notification-catalog';

async function requireSession(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!payload?.userId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  return { payload };
}

function withHref(row) {
  return {
    ...row,
    href: notificationHref(row.type, row.payload || {}),
  };
}

/** GET /api/me/notifications — `?count=1` returns only { unreadCount, latestAt } (badge polling). */
export async function GET(request) {
  const { payload, error } = await requireSession(request);
  if (error) return error;

  const url = new URL(request.url);
  if (url.searchParams.get('count') === '1') {
    return NextResponse.json(await countUnreadNotificationsForUser(queryRead, payload.userId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = parseInt(url.searchParams.get('limit') || '30', 10);

  const data = await listNotificationsForUser(query, payload.userId, { limit, unreadOnly });
  return NextResponse.json({
    items: (data.items || []).map(withHref),
    unreadCount: data.unreadCount,
  });
}

/**
 * PATCH /api/me/notifications
 * body: { id } | { all: true }
 */
export async function PATCH(request) {
  const { payload, error } = await requireSession(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (body.all === true) {
    const r = await markAllNotificationsRead(query, payload.userId);
    const { unreadCount } = await countUnreadNotificationsForUser(query, payload.userId);
    return NextResponse.json({ ok: true, updated: r.updated, unreadCount });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) return apiError(request, ERR.INVALID_DATA, 400);

  const r = await markNotificationRead(query, payload.userId, id);
  if (!r.ok) return apiError(request, ERR.NOT_FOUND, 404);

  const { unreadCount } = await countUnreadNotificationsForUser(query, payload.userId);
  return NextResponse.json({ ok: true, unreadCount });
}
