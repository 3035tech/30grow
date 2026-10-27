import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { revokeMobileEmployeeSession } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { parseJsonBody } from '../../../../../../lib/validate.js';

const logoutSchema = z.object({ refreshToken: z.string().min(32).max(256) });
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request) {
  try {
    const parsed = await parseJsonBody(request, logoutSchema);
    if (!parsed.ok) return parsed.response;
    await revokeMobileEmployeeSession(parsed.data.refreshToken);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-logout]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
