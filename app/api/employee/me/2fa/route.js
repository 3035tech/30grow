import { NextResponse } from 'next/server';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee-session.js';
import {
  beginEmployee2faSetup,
  disableEmployee2fa,
  enableEmployee2fa,
  loadEmployee2faState,
} from '../../../../../lib/employee-2fa.js';

export const dynamic = 'force-dynamic';

async function requireEmployeeSession(request) {
  const session = await getEmployeeSessionPayload();
  if (!session) return { error: apiError(request, ERR.UNAUTHORIZED, 401) };
  return { session };
}

/** GET /api/employee/me/2fa — status */
export async function GET(request) {
  const { session, error } = await requireEmployeeSession(request);
  if (error) return error;

  const state = await loadEmployee2faState(session.candidateId, session.companyId);
  if (!state) return apiError(request, ERR.NOT_FOUND, 404);

  return NextResponse.json({
    canUse2Fa: state.canUse2Fa,
    enabled: state.enabled,
  });
}

/** POST /api/employee/me/2fa — iniciar setup */
export async function POST(request) {
  const { session, error } = await requireEmployeeSession(request);
  if (error) return error;

  const result = await beginEmployee2faSetup(session.candidateId, session.companyId);
  if (!result.ok) {
    if (result.code === 'FORBIDDEN') {
      return apiError(request, ERR.TWO_FA_FORBIDDEN, httpStatusForError(ERR.TWO_FA_FORBIDDEN));
    }
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

/** PATCH /api/employee/me/2fa — confirmar e ativar */
export async function PATCH(request) {
  const { session, error } = await requireEmployeeSession(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const result = await enableEmployee2fa(session.candidateId, session.companyId, body.code);
  if (!result.ok) {
    if (result.code === 'TOTP_INVALID') {
      return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
    }
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

/** DELETE /api/employee/me/2fa — desativar */
export async function DELETE(request) {
  const { session, error } = await requireEmployeeSession(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const result = await disableEmployee2fa(session.candidateId, session.companyId, {
    code: body.code,
    password: body.password,
  });
  if (!result.ok) {
    if (result.code === 'RATE_LIMIT') {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(result.retryAfterSec) },
      });
    }
    if (result.code === 'TOTP_INVALID') {
      return apiError(request, ERR.TOTP_INVALID, httpStatusForError(ERR.TOTP_INVALID));
    }
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
