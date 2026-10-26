import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/identity/rate-limit';

/** GET /api/public/ae-invite-track?token= — marca convite como aberto. */
export async function GET(request) {
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`ae-invite-track:${ip}`, 120, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const token = String(searchParams.get('token') || '').trim();
    if (!token) return NextResponse.json({ ok: false }, { status: 400 });

    await query(
      `UPDATE ae_invites
       SET status = 'opened', opened_at = COALESCE(opened_at, NOW())
       WHERE token = $1 AND status = 'sent'`,
      [token]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('GET /api/public/ae-invite-track', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
