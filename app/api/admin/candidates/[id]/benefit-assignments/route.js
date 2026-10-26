import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { CAP, getManagerScope, getSessionPayload, requireCapability } from '../../../../../../lib/ae/require-admin.js';
import { listCompanyBenefits } from '../../../../../../lib/company/company-benefits.js';
import {
  assignEmployeeBenefit,
  listEmployeeBenefitAssignments,
} from '../../../../../../lib/people/employee-benefit-assignments.js';

async function loadCandidateScope(candidateId, scope) {
  const c = await query(
    `SELECT id, company_id AS "companyId",
            employment_status AS "employmentStatus"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (c.rowCount === 0) return { error: ERR.NOT_FOUND };
  if (!scope.isAdmin && String(c.rows[0].companyId) !== String(scope.companyId)) {
    return { error: ERR.UNAUTHORIZED };
  }
  return { candidate: c.rows[0] };
}

/** GET /api/admin/candidates/[id]/benefit-assignments */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.TEAM_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const companyId = loaded.candidate.companyId;
    const url = new URL(request.url);
    const includeEnded = url.searchParams.get('includeEnded') !== '0';

    const result = await listEmployeeBenefitAssignments(query, {
      companyId,
      candidateId,
      includeEnded,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    const catalog = await listCompanyBenefits(query, {
      companyId,
      includeInactive: false,
      limit: 100,
    });

    return NextResponse.json({
      items: result.items,
      employmentStatus: result.employmentStatus,
      catalog: Array.isArray(catalog) ? catalog : catalog?.items || [],
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET benefit-assignments', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/admin/candidates/[id]/benefit-assignments */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.TEAM_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const body = await request.json().catch(() => ({}));
    const result = await assignEmployeeBenefit(query, {
      companyId: loaded.candidate.companyId,
      candidateId,
      benefitId: body.benefitId,
      valueNote: body.valueNote,
      startsOn: body.startsOn,
      createdByUserId: payload.userId || null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'employee_benefit.assign',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { assignmentId: result.item?.id, benefitId: body.benefitId },
    });

    return NextResponse.json({ ok: true, item: result.item }, { status: 201 });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST benefit-assignments', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
