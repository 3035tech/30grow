import { NextResponse } from 'next/server';
import { query } from '../../../../../../../lib/db';
import { apiError, ERR } from '../../../../../../../lib/api-error';
import { audit } from '../../../../../../../lib/audit';
import { CAP, getManagerScope, getSessionPayload, requireCapability } from '../../../../../../../lib/ae/require-admin';
import {
  addDevelopmentPlanItem,
  getDevelopmentPlan,
  updateDevelopmentPlan,
  updateDevelopmentPlanItem,
} from '../../../../../../../lib/people/development-plans';
import { linkResourceToPdi, unlinkResourceFromPdi } from '../../../../../../../lib/learning-resources';
import {
  enrollLmsCandidates,
  linkLmsCourseToPdi,
  unlinkLmsCourseFromPdi,
} from '../../../../../../../lib/lms.js';

async function loadCandidateScope(candidateId, scope) {
  const c = await query(
    `SELECT id, company_id AS "companyId" FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (c.rowCount === 0) return { error: 'NOT_FOUND' };
  if (!scope.isAdmin && String(c.rows[0].companyId) !== String(scope.companyId)) {
    return { error: 'UNAUTHORIZED' };
  }
  return { candidate: c.rows[0] };
}

async function notifyEmployeePdi(companyId, candidateId, { planId, planTitle, itemTitle }) {
  try {
    const { notifyCandidate, EMPLOYEE_NOTIF } = await import(
      '../../../../../../../lib/employee/employee-notifications.js'
    );
    await notifyCandidate(query, {
      companyId,
      candidateId: Number(candidateId),
      type: EMPLOYEE_NOTIF.PDI_UPDATED,
      entityType: 'development_plan',
      entityId: planId,
      dedupeKey: `pdi_upd:${planId}:${Date.now()}`,
      payload: {
        planId,
        planTitle: planTitle || itemTitle || 'PDI',
        itemTitle: itemTitle || null,
      },
    });
  } catch {
    /* optional */
  }
}

/** GET /api/admin/candidates/[id]/development-plans/[planId] */
export async function GET(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.TEAM_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    const planId = params?.planId;
    if (!candidateId || !planId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const plan = await getDevelopmentPlan(query, {
      companyId: loaded.candidate.companyId,
      planId,
      candidateId,
    });
    if (!plan) return apiError(request, ERR.NOT_FOUND, 404);
    return NextResponse.json({ plan });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET development-plan', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** PATCH /api/admin/candidates/[id]/development-plans/[planId] */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.TEAM_VIEW)) return apiError(request, ERR.UNAUTHORIZED, 401);
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    const planId = params?.planId;
    if (!candidateId || !planId) return apiError(request, ERR.INVALID_ID, 400);

    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) return apiError(request, loaded.error, loaded.error === 'NOT_FOUND' ? 404 : 401);

    const body = await request.json().catch(() => ({}));

    if (body.linkResource?.itemId && body.linkResource?.resourceId) {
      const linked = await linkResourceToPdi(query, {
        companyId: loaded.candidate.companyId,
        planItemId: body.linkResource.itemId,
        resourceId: body.linkResource.resourceId,
      });
      if (!linked.ok) {
        return apiError(request, linked.errorCode || ERR.INVALID_REFERENCE, 400);
      }
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.resource_link',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: {
          planId,
          itemId: body.linkResource.itemId,
          resourceId: body.linkResource.resourceId,
        },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      return NextResponse.json({ ok: true, plan });
    }

    if (body.unlinkResource?.itemId && body.unlinkResource?.resourceId) {
      await unlinkResourceFromPdi(query, {
        companyId: loaded.candidate.companyId,
        planItemId: body.unlinkResource.itemId,
        resourceId: body.unlinkResource.resourceId,
      });
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.resource_unlink',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: {
          planId,
          itemId: body.unlinkResource.itemId,
          resourceId: body.unlinkResource.resourceId,
        },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      return NextResponse.json({ ok: true, plan });
    }

    if (body.linkLmsCourse?.itemId && body.linkLmsCourse?.courseId) {
      const linked = await linkLmsCourseToPdi(query, {
        companyId: loaded.candidate.companyId,
        planItemId: body.linkLmsCourse.itemId,
        courseId: body.linkLmsCourse.courseId,
      });
      if (!linked.ok) {
        return apiError(request, linked.errorCode || ERR.INVALID_REFERENCE, 400);
      }
      let enrolled = 0;
      if (body.linkLmsCourse.enroll === true) {
        const enr = await enrollLmsCandidates(query, {
          companyId: loaded.candidate.companyId,
          courseId: body.linkLmsCourse.courseId,
          candidateIds: [Number(candidateId)],
          enrolledByUserId: payload.userId || null,
          dueDate: body.linkLmsCourse.dueDate || null,
          mandatory: body.linkLmsCourse.mandatory === true,
        });
        if (enr.ok) enrolled = enr.enrolled || 0;
      }
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.lms_link',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: {
          planId,
          itemId: body.linkLmsCourse.itemId,
          courseId: body.linkLmsCourse.courseId,
          enrolled,
        },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      return NextResponse.json({ ok: true, plan, enrolled });
    }

    if (body.unlinkLmsCourse?.itemId && body.unlinkLmsCourse?.courseId) {
      await unlinkLmsCourseFromPdi(query, {
        companyId: loaded.candidate.companyId,
        planItemId: body.unlinkLmsCourse.itemId,
        courseId: body.unlinkLmsCourse.courseId,
      });
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.lms_unlink',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: {
          planId,
          itemId: body.unlinkLmsCourse.itemId,
          courseId: body.unlinkLmsCourse.courseId,
        },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      return NextResponse.json({ ok: true, plan });
    }

    if (body.item && body.item.id) {
      const updItem = await updateDevelopmentPlanItem(query, {
        companyId: loaded.candidate.companyId,
        planId,
        itemId: body.item.id,
        title: body.item.title,
        notes: body.item.notes,
        status: body.item.status,
        dueDate: body.item.dueDate,
        oneOnOneId: body.item.oneOnOneId,
        ownerLabel: body.item.ownerLabel,
      });
      if (!updItem.ok) return apiError(request, updItem.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.item_update',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: { planId, itemId: body.item.id },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      return NextResponse.json({ ok: true, plan, item: updItem.item });
    }

    if (body.addItem) {
      const added = await addDevelopmentPlanItem(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
        title: body.addItem.title,
        notes: body.addItem.notes,
        status: body.addItem.status,
        source: body.addItem.source,
        dueDate: body.addItem.dueDate,
        oneOnOneId: body.addItem.oneOnOneId,
        ownerLabel: body.addItem.ownerLabel,
      });
      if (!added.ok) return apiError(request, added.errorCode || 'INVALID_DATA', 400);
      await audit({
        actorUserId: payload.userId || null,
        action: 'development_plan.item_add',
        targetType: 'candidate',
        targetId: candidateId,
        metadata: { planId, itemId: added.item.id },
      });
      const plan = await getDevelopmentPlan(query, {
        companyId: loaded.candidate.companyId,
        planId,
        candidateId,
      });
      await notifyEmployeePdi(loaded.candidate.companyId, candidateId, {
        planId,
        planTitle: plan?.title,
        itemTitle: added.item.title,
      });
      return NextResponse.json({ ok: true, plan, item: added.item });
    }

    const updated = await updateDevelopmentPlan(query, {
      companyId: loaded.candidate.companyId,
      planId,
      candidateId,
      title: body.title,
      objective: body.objective,
      status: body.status,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
    });
    if (!updated.ok) return apiError(request, updated.errorCode || 'INVALID_DATA', 400);

    await audit({
      actorUserId: payload.userId || null,
      action: 'development_plan.update',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: { planId },
    });

    await notifyEmployeePdi(loaded.candidate.companyId, candidateId, {
      planId,
      planTitle: updated.plan?.title,
    });

    return NextResponse.json({ ok: true, plan: updated.plan });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('PATCH development-plan', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
