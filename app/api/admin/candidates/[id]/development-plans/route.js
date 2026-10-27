import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import { apiError, ERR } from '../../../../../../lib/api-error';
import { audit } from '../../../../../../lib/audit';
import { CAP, getManagerScope, getSessionPayload, requireCapability } from '../../../../../../lib/ae/require-admin';
import {
  createDevelopmentPlan,
  importItemsFromOneOnOne,
  listDevelopmentPlans,
} from '../../../../../../lib/people/development-plans';

async function loadCandidateScope(candidateId, scope) {
  const c = await query(
    `SELECT id, company_id AS "companyId", full_name AS "fullName"
     FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (c.rowCount === 0) return { error: 'NOT_FOUND' };
  if (!scope.isAdmin && String(c.rows[0].companyId) !== String(scope.companyId)) {
    return { error: 'UNAUTHORIZED' };
  }
  return { candidate: c.rows[0] };
}

/** GET /api/admin/candidates/[id]/development-plans */
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
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const items = await listDevelopmentPlans(query, {
      companyId: loaded.candidate.companyId,
      candidateId,
    });
    return NextResponse.json({ items });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET development-plans', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/admin/candidates/[id]/development-plans */
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
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const body = await request.json().catch(() => ({}));

    if (body.action === 'fromOneOnOne' || body.oneOnOneId) {
      const imported = await importItemsFromOneOnOne(query, {
        companyId: loaded.candidate.companyId,
        candidateId,
        oneOnOneId: body.oneOnOneId,
        planId: body.planId,
        createdByUserId: payload.userId || null,
        ownerLabel: body.ownerLabel,
        periodDays: body.periodDays,
      });
      if (!imported.ok) {
        return apiError(request, imported.errorCode || 'INVALID_DATA', 400);
      }
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.from_one_on_one',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: { planId: imported.plan?.id, addedCount: imported.addedCount },
      });
      return NextResponse.json({
        ok: true,
        plan: imported.plan,
        addedCount: imported.addedCount,
        linesParsed: imported.linesParsed,
      });
    }

    const created = await createDevelopmentPlan(query, {
      companyId: loaded.candidate.companyId,
      candidateId,
      title: body.title,
      objective: body.objective,
      status: body.status,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      createdByUserId: payload.userId || null,
      seedIdeas: body.seedIdeas,
    });
    if (!created.ok) {
      return apiError(request, created.errorCode || 'INVALID_DATA', 400);
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'development_plan.create',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { planId: created.plan.id },
    });

    try {
      const { notifyCandidate, EMPLOYEE_NOTIF } = await import('../../../../../../lib/employee/employee-notifications.js');
      await notifyCandidate(query, {
        companyId: loaded.candidate.companyId,
        candidateId: Number(candidateId),
        type: EMPLOYEE_NOTIF.PDI_UPDATED,
        entityType: 'development_plan',
        entityId: created.plan.id,
        dedupeKey: `pdi_created:${created.plan.id}`,
        payload: { planTitle: created.plan.title, planId: created.plan.id },
      });
    } catch {
      /* optional */
    }

    return NextResponse.json({ ok: true, plan: created.plan }, { status: 201 });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST development-plans', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
