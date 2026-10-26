import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyToken } from '../../../../lib/identity/auth';
import { isManagerRole } from '../../../../lib/identity/permissions';
import { isSessionVersionCurrent } from '../../../../lib/identity/session-revocation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session-edge — sessão gestor ainda válida (JWT + session_version).
 * Usado pelo middleware Edge (sem Postgres direto).
 */
export async function GET() {
  const token = await (await cookies()).get(COOKIE_NAME)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!isManagerRole(payload)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const live = await isSessionVersionCurrent(payload.userId, payload.sv);
  if (!live) {
    return NextResponse.json({ ok: false, revoked: true }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
