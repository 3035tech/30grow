import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, sessionCookieOptions, verifyToken } from '../../../../lib/identity/auth';
import { bumpSessionVersion } from '../../../../lib/identity/session';

export async function POST() {
  const token = await (await cookies()).get(COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;
  if (payload?.userId) {
    try {
      await bumpSessionVersion(payload.userId);
    } catch {
      /* migration ausente ou user sumiu — ainda limpa cookie */
    }
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', sessionCookieOptions({ maxAge: 0 }));
  return response;
}
