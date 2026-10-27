import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { EMPLOYEE_COOKIE_NAME } from '../../../../../lib/employee/employee-auth-constants.js';
import { verifyEmployeeToken } from '../../../../../lib/employee/employee-auth.js';
import {
  isEmployeeSessionVersionCurrent,
  loadEmployeeSessionVersion,
} from '../../../../../lib/employee/employee-session-revocation.js';
import { EMPLOYMENT_STATUS } from '../../../../../lib/domain-status.js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/employee/session-edge — sessão colaborador ainda válida (JWT + session_version).
 * Usado pelo middleware Edge (sem Postgres direto).
 */
export async function GET() {
  const token = await (await cookies()).get(EMPLOYEE_COOKIE_NAME)?.value;
  const payload = token ? verifyEmployeeToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const claimSv = Number(payload.sv);
  if (!Number.isFinite(claimSv) || claimSv < 1) {
    return NextResponse.json({ ok: false, revoked: true }, { status: 401 });
  }

  const live = await isEmployeeSessionVersionCurrent(
    payload.candidateId,
    payload.companyId,
    claimSv
  );
  if (!live) {
    return NextResponse.json({ ok: false, revoked: true }, { status: 401 });
  }

  const row = await loadEmployeeSessionVersion(payload.candidateId, payload.companyId);
  if (row?.employmentStatus && row.employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
    return NextResponse.json({ ok: false, revoked: true }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
