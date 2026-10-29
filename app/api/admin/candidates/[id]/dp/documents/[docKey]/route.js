import { query } from '../../../../../../../../lib/db.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../../lib/api-error.js';
import {
  CAP,
  getManagerScope,
  getSessionPayload,
  requireAnyCapability,
} from '../../../../../../../../lib/ae/require-admin.js';
import {
  updateDpDocument,
  requestDpDocumentSignature,
  waiveDpDocumentSignature,
} from '../../../../../../../../lib/people/employee-dp.js';
import { audit, auditRequestContext, AUDIT_ACTOR_KIND } from '../../../../../../../../lib/audit.js';
import {
  notifyCandidates,
  EMPLOYEE_NOTIF,
} from '../../../../../../../../lib/employee/employee-notifications.js';
import { NextResponse } from 'next/server';

const DP_OR_TEAM = Object.freeze([CAP.DP_VIEW, CAP.TEAM_VIEW]);

async function loadCandidateScope(candidateId, scope) {
  const c = await query(
    `SELECT id, company_id AS "companyId" FROM candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (c.rowCount === 0) return { error: ERR.NOT_FOUND };
  if (!scope.isAdmin && String(c.rows[0].companyId) !== String(scope.companyId)) {
    return { error: ERR.UNAUTHORIZED };
  }
  return { candidate: c.rows[0] };
}

/** PATCH /api/admin/candidates/[id]/dp/documents/[docKey] */
export async function PATCH(request, props) {
  const params = await props.params;
  try {
    const payload = await getSessionPayload();
    if (!requireAnyCapability(payload, DP_OR_TEAM)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const candidateId = params?.id;
    const docKey = params?.docKey;
    if (!candidateId || !docKey) return apiError(request, ERR.INVALID_ID, 400);
    const loaded = await loadCandidateScope(candidateId, scope);
    if (loaded.error) {
      return apiError(request, loaded.error, loaded.error === ERR.NOT_FOUND ? 404 : 401);
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const companyId = loaded.candidate.companyId;

    if (action === 'requestSignature') {
      const result = await requestDpDocumentSignature({ query }, {
        companyId,
        candidateId,
        docKey,
        requestedByUserId: payload.userId,
      });
      if (!result.ok) return apiErrorFromResult(request, result);
      await audit({
        actorUserId: payload.userId || null,
        actorKind: AUDIT_ACTOR_KIND.MANAGER,
        companyId,
        action: 'dp_doc.signature_request',
        targetType: 'employee_dp_document',
        targetId: result.item.id,
        metadata: { candidateId: Number(candidateId), docKey },
        ...auditRequestContext(request),
      });
      await notifyCandidates({ query }, {
        companyId,
        candidateIds: [Number(candidateId)],
        type: EMPLOYEE_NOTIF.DP_SIGNATURE_REQUESTED,
        payload: { docKey, candidateId: Number(candidateId) },
      }).catch(() => {});
      return NextResponse.json({ ok: true, item: result.item });
    }

    if (action === 'waiveSignature') {
      const result = await waiveDpDocumentSignature({ query }, {
        companyId,
        candidateId,
        docKey,
        waivedByUserId: payload.userId,
      });
      if (!result.ok) return apiErrorFromResult(request, result);
      await audit({
        actorUserId: payload.userId || null,
        actorKind: AUDIT_ACTOR_KIND.MANAGER,
        companyId,
        action: 'dp_doc.signature_waive',
        targetType: 'employee_dp_document',
        targetId: result.item.id,
        metadata: { candidateId: Number(candidateId), docKey },
        ...auditRequestContext(request),
      });
      return NextResponse.json({ ok: true, item: result.item });
    }

    const result = await updateDpDocument({ query }, {
      companyId,
      candidateId,
      docKey,
      status: body.status,
      notes: body.notes,
      rejectionReason: body.rejectionReason,
      userId: payload.userId,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({
      actorUserId: payload.userId || null,
      actorKind: AUDIT_ACTOR_KIND.MANAGER,
      companyId,
      action: result.item.status === 'rejected' ? 'dp_doc.rejected' : 'dp_doc.updated',
      targetType: 'employee_dp_document',
      targetId: result.item.id,
      metadata: {
        candidateId: Number(candidateId), docKey, status: result.item.status,
        ...(result.item.status === 'rejected' ? { rejectionReason: result.item.rejectionReason } : {}),
      },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('PATCH dp documents', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
