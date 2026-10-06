import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth.js';
import { apiError, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { verifySessionWithCapabilities } from '../../../../lib/session.js';
import {
  begin2faSetup,
  disable2fa,
  enable2fa,
  loadUser2faState,
  roleMayUse2Fa,
} from '../../../../lib/manager-2fa.js';

export const dynamic = 'force-dynamic';

async function requireUserId(request) {
  const token = await (await cookies()).get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!payload?.userId) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  return { userId: payload.userId };
}

/** GET /api/me/2fa — status */
export async function GET(request) {
  const { userId, error } = await requireUserId(request);
  if (error) return error;

  const state = await loadUser2faState(userId);
  if (!state) return apiError(request, ERR.NOT_FOUND, 404);

  return NextResponse.json({
    canUse2Fa: state.canUse2Fa,
    enabled: state.enabled,
  });
}

/** POST /api/me/2fa — iniciar setup (retorna secret + otpauth URL) */
export async function POST(request) {
  const { userId, error } = await requireUserId(request);
  if (error) return error;

  const result = await begin2faSetup(userId);
  if (!result.ok) {
    if (result.code === 'FORBIDDEN') return apiError(request, ERR.TWO_FA_FORBIDDEN, httpStatusForError(ERR.TWO_FA_FORBIDDEN));
    if (result.code === 'ALREADY_ENABLED') {
      return apiError(request, ERR.TWO_FA_ALREADY_ENABLED, httpStatusForError(ERR.TWO_FA_ALREADY_ENABLED));
    }
    return apiError(request, ERR.NOT_FOUND, 404);
  }

  return NextResponse.json({
    ok: true,
    secret: result.secret,
    otpauthUrl: result.otpauthUrl,
  });
}

/** PATCH /api/me/2fa — confirmar código e ativar */
export async function PATCH(request) {
  const { userId, error } = await requireUserId(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const result = await enable2fa(userId, body.code);
  if (!result.ok) {
    if (result.code === 'TOTP_INVALID') return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
    if (result.code === 'SETUP_REQUIRED') {
      return apiError(request, ERR.TWO_FA_SETUP_REQUIRED, httpStatusForError(ERR.TWO_FA_SETUP_REQUIRED));
    }
    if (result.code === 'ALREADY_ENABLED') {
      return apiError(request, ERR.TWO_FA_ALREADY_ENABLED, httpStatusForError(ERR.TWO_FA_ALREADY_ENABLED));
    }
    return apiError(request, ERR.TWO_FA_FORBIDDEN, httpStatusForError(ERR.TWO_FA_FORBIDDEN));
  }

  return NextResponse.json({ ok: true, enabled: true });
}

/** DELETE /api/me/2fa — desativar (senha + código) */
export async function DELETE(request) {
  const { userId, error } = await requireUserId(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const result = await disable2fa(userId, { code: body.code, password: body.password });
  if (!result.ok) {
    if (result.code === 'RATE_LIMIT') {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(result.retryAfterSec) },
      });
    }
    if (result.code === 'TOTP_INVALID') return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
    if (result.code === 'INVALID_CREDENTIALS') {
      return apiError(request, ERR.INVALID_CREDENTIALS, httpStatusForError(ERR.INVALID_CREDENTIALS));
    }
    if (result.code === 'NOT_ENABLED') {
      return apiError(request, ERR.TWO_FA_NOT_ENABLED, httpStatusForError(ERR.TWO_FA_NOT_ENABLED));
    }
    return apiError(request, ERR.TWO_FA_FORBIDDEN, httpStatusForError(ERR.TWO_FA_FORBIDDEN));
  }

  return NextResponse.json({ ok: true, enabled: false });
}
