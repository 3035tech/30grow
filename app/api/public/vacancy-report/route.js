import { NextResponse } from 'next/server';
import { getReportByToken } from '../../../../lib/recruiting/vacancy-report';
import { apiError, ERR } from '../../../../lib/api-error';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-vacancy-report:${ip}`, 60, 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const { searchParams } = new URL(request.url);
    const token = String(searchParams.get('token') || '').trim();
    if (!token) return apiError(request, ERR.INVALID_TOKEN, 400);

    const row = await getReportByToken(token);
    if (!row) return apiError(request, ERR.EXPIRED_LINK, 404);

    const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {};

    return NextResponse.json(
      {
        title: row.title,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        executiveNote: row.executiveNote || snapshot.executiveNote || null,
        snapshot,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      }
    );
  } catch (e) {
    console.error('[public vacancy-report]', e);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
