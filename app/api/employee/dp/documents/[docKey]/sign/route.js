/**
 * POST /api/employee/dp/documents/[docKey]/sign — canvas stroke + typed-name acknowledgment
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee/employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';
import { signDpDocument, getEmployeeDisplayName } from '../../../../../../../lib/people/employee-dp.js';
import { audit, auditRequestContext, AUDIT_ACTOR_KIND } from '../../../../../../../lib/audit.js';
import { notifyCompanyManagers } from '../../../../../../../lib/manager-notifications.js';
import { NOTIF } from '../../../../../../../lib/manager-notification-catalog.js';

export const dynamic = 'force-dynamic';

export async function POST(request, props) {
  const params = await props.params;
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { companyId, candidateId } = session;
    const docKey = params?.docKey;
    if (!docKey) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(`emp-dp-sign:${candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const ua = String(request.headers.get('user-agent') || '').slice(0, 300);
    const result = await signDpDocument({ query }, {
      companyId,
      candidateId,
      docKey,
      signerName: body.signerName,
      consent: Boolean(body.consent),
      strokePng: body.strokePng || '',
      signerIp: clientIpFromRequest(request),
      signerUserAgent: ua,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    await audit({
      actorCandidateId: candidateId,
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      companyId,
      action: 'dp_doc.signed',
      targetType: 'employee_dp_document',
      targetId: result.item.id,
      metadata: {
        docKey,
        signerName: result.item.signerName,
        consentVersion: result.item.signatureConsentVersion,
      },
      ...auditRequestContext(request),
    });

    const name = await getEmployeeDisplayName({ query }, { companyId, candidateId });
    await notifyCompanyManagers(query, {
      companyId,
      type: NOTIF.DP_DOC_SIGNED,
      entityType: 'candidate',
      entityId: candidateId,
      dedupeKey: `dp_doc_sig:${candidateId}:${docKey}:${result.item.signedAt || Date.now()}`,
      payload: {
        candidateId,
        candidateName: name,
        name,
        docKey: String(docKey),
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/dp/documents/.../sign', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
