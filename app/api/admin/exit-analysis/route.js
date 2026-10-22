import { audit } from '../../../../lib/audit.js';
import { NextResponse } from 'next/server';
import { getSessionPayload, getManagerScope, CAP, requireCapability } from '../../../../lib/ae/require-admin.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { createExitRecord, listExitRecords } from '../../../../lib/exit-analysis.js';

/**
 * GET /api/admin/exit-analysis — list exit records (admin/direction/hr)
 * POST /api/admin/exit-analysis — create exit record (admin/direction/hr)
 */

export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.EXIT_ANALYSIS_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const companyId = scope.isAdmin
      ? Number(new URL(request.url).searchParams.get('companyId') || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit')) || 100;

    const records = await listExitRecords(null, { companyId, limit });
    return NextResponse.json({ ok: true, records }, { status: 200 });
  } catch (err) {
    console.error('GET /api/admin/exit-analysis error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.EXIT_ANALYSIS_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return apiError(request, ERR.INVALID_JSON, 400);
    }

    const companyId = scope.isAdmin
      ? Number(body.companyId || scope.companyId)
      : Number(scope.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return apiError(request, ERR.COMPANY_REQUIRED, 400);
    }

    const { candidateId, exitDate, exitType, exitReason, notes, personalEmail } = body;
    if (!candidateId) {
      return apiError(request, ERR.MISSING_CANDIDATE_ID, 400);
    }

    const result = await createExitRecord(null, {
      companyId,
      candidateId: Number(candidateId),
      exitDate,
      exitType,
      exitReason,
      notes,
      personalEmail,
      createdByUserId: payload.userId,
    });

    if (!result.ok) {
      if (result.errorCode === ERR.INVALID_EMAIL) return apiError(request, ERR.INVALID_EMAIL, 400);
      if (result.errorCode === ERR.EMAIL_TAKEN) return apiError(request, ERR.EMAIL_TAKEN, 409);
      if (result.errorCode === 'CANDIDATE_NOT_FOUND') {
        return apiError(request, ERR.CANDIDATE_NOT_FOUND, 404);
      }
      if (result.errorCode === 'NOT_EMPLOYEE') {
        return apiError(request, ERR.NOT_EMPLOYEE, 400);
      }
      if (result.errorCode === 'EXIT_ALREADY_RECORDED') {
        return apiError(request, ERR.EXIT_ALREADY_RECORDED, 409);
      }
      return apiError(request, ERR.EXIT_RECORD_FAILED, 500);
    }

    await audit({ actorUserId: payload.userId || null, companyId, action: 'employee.exit', targetType: 'candidate', targetId: String(candidateId), metadata: { previousEmail: result.previousEmail || null, contactSource: 'personal_email', portalAccessRevoked: true } });
    return NextResponse.json({ ok: true, exitRecord: result.exitRecord }, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/exit-analysis error:', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
