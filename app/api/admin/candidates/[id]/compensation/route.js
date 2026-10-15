import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { audit } from '../../../../../../lib/audit.js';
import { CAP, getManagerScope, getSessionPayload, requireCapability } from '../../../../../../lib/ae/require-admin.js';
import {
  createCompensationEvent,
  getAcceptedOfferHint,
  getCompensationMarketContext,
  importCompensationFromOffer,
  listCompensationEvents,
  setCandidateJobRole,
} from '../../../../../../lib/people/employee-compensation.js';

async function loadCandidateScope(candidateId, scope) {
  const params = [candidateId];
  const tenantFilter = scope.isAdmin ? '' : 'AND company_id = $2';
  if (!scope.isAdmin) params.push(scope.companyId);
  const c = await query(
    `SELECT id, company_id AS "companyId",
            employment_status AS "employmentStatus"
     FROM candidates
     WHERE id = $1 ${tenantFilter}
     LIMIT 1`,
    params
  );
  if (c.rowCount === 0) return { error: ERR.NOT_FOUND };
  return { candidate: c.rows[0] };
}

/** GET /api/admin/candidates/[id]/compensation */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.COMPENSATION_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const companyId = loaded.candidate.companyId;
    const result = await listCompensationEvents(query, { companyId, candidateId });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    const offerHint = await getAcceptedOfferHint(query, { companyId, candidateId });
    const market = await getCompensationMarketContext(query, { companyId, candidateId });

    return NextResponse.json({
      items: result.items,
      current: result.current,
      employmentStatus: result.employmentStatus,
      offerHint,
      market: market.ok
        ? {
            jobRoleId: market.jobRoleId,
            jobRoleName: market.jobRoleName,
            marketSalaryMin: market.marketSalaryMin,
            marketSalaryMax: market.marketSalaryMax,
            compare: market.compare,
          }
        : null,
    });
  } catch (err) {
    if(err?.code==='23514' && err?.message===ERR.POSITION_IN_USE)return apiErrorFromResult(request,{errorCode:ERR.POSITION_IN_USE});
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('GET compensation', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/admin/candidates/[id]/compensation */
export async function POST(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.COMPENSATION_MANAGE)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    if (!candidateId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const body = await request.json().catch(() => ({}));
    const companyId = loaded.candidate.companyId;

    let result;
    if (body.action === 'importFromOffer') {
      result = await importCompensationFromOffer(query, {
        companyId,
        candidateId,
        createdByUserId: payload.userId || null,
      });
    } else if (body.action === 'setJobRole') {
      const marketResult = await setCandidateJobRole(query, {
        companyId,
        candidateId,
        jobRoleId: body.jobRoleId ?? null,
      });
      if (!marketResult.ok) {
        return apiErrorFromResult(request, marketResult, { fallbackCode: ERR.INVALID_DATA });
      }
      await audit({
        actorUserId: payload.userId || null,
        companyId,
        action: 'compensation.set_job_role',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: { jobRoleId: marketResult.jobRoleId },
      });
      const summary = await listCompensationEvents(query, { companyId, candidateId });
      return NextResponse.json({
        ok: true,
        items: summary.ok ? summary.items : [],
        current: summary.ok ? summary.current : null,
        market: {
          jobRoleId: marketResult.jobRoleId,
          jobRoleName: marketResult.jobRoleName,
          marketSalaryMin: marketResult.marketSalaryMin,
          marketSalaryMax: marketResult.marketSalaryMax,
          compare: marketResult.compare,
        },
      });
    } else {
      result = await createCompensationEvent(query, {
        companyId,
        candidateId,
        eventType: body.eventType,
        amount: body.amount,
        effectiveDate: body.effectiveDate,
        notes: body.notes,
        createdByUserId: payload.userId || null,
      });
    }

    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    await audit({
      actorUserId: payload.userId || null,
      companyId,
      action: body.action === 'importFromOffer' ? 'compensation.import_offer' : 'compensation.create',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { eventId: result.event?.id, eventType: result.event?.eventType },
    });

    const summary = await listCompensationEvents(query, { companyId, candidateId });
    const market = await getCompensationMarketContext(query, { companyId, candidateId });
    return NextResponse.json({
      ok: true,
      event: result.event,
      items: summary.ok ? summary.items : [],
      current: summary.ok ? summary.current : result.event,
      market: market.ok
        ? {
            jobRoleId: market.jobRoleId,
            jobRoleName: market.jobRoleName,
            marketSalaryMin: market.marketSalaryMin,
            marketSalaryMax: market.marketSalaryMax,
            compare: market.compare,
          }
        : null,
    });
  } catch (err) {
    if(err?.code==='23514' && err?.message===ERR.POSITION_IN_USE)return apiErrorFromResult(request,{errorCode:ERR.POSITION_IN_USE});
    if (err?.code === '42P01' || err?.code === '42703') {
      return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    }
    console.error('POST compensation', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
