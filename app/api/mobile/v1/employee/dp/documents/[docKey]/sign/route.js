import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../../../lib/api-error.js';
import { AUDIT_ACTOR_KIND, audit, auditRequestContext } from '../../../../../../../../../lib/audit.js';
import { query } from '../../../../../../../../../lib/db.js';
import { DP_DOCUMENT_KEYS } from '../../../../../../../../../lib/domain-status.js';
import { NOTIF } from '../../../../../../../../../lib/manager-notification-catalog.js';
import { notifyCompanyManagers } from '../../../../../../../../../lib/manager-notifications.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../../../lib/mobile/mobile-employee-session.js';
import { getEmployeeDisplayName, getEmployeeDpHome, signDpDocument } from '../../../../../../../../../lib/people/employee-dp.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../../../lib/identity/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const SIGNATURE_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const AUDIT_ACTION = Object.freeze({ DOCUMENT_SIGNED: 'dp_doc.signed' });

export async function POST(request, props) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const params = await props.params;
    const docKey = String(params?.docKey || '');
    if (!DP_DOCUMENT_KEYS.includes(docKey)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const limit = await checkRateLimit(`mobile-employee-dp-sign:${session.candidateId}:${clientIpFromRequest(request)}`, SIGNATURE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    const result = await signDpDocument({ query }, { companyId: session.companyId, candidateId: session.candidateId, docKey, signerName: body.signerName, consent: body.consent === true, strokePng: body.strokePng, signerIp: clientIpFromRequest(request), signerUserAgent: String(request.headers.get('user-agent') || '').slice(0, 300) });
    if (!result.ok) return apiErrorFromResult(request, result);
    await audit({ actorCandidateId: session.candidateId, actorKind: AUDIT_ACTOR_KIND.EMPLOYEE, companyId: session.companyId, action: AUDIT_ACTION.DOCUMENT_SIGNED, targetType: 'employee_dp_document', targetId: result.item.id, metadata: { docKey, signerName: result.item.signerName, consentVersion: result.item.signatureConsentVersion }, ...auditRequestContext(request) });
    try {
      const candidateName = await getEmployeeDisplayName({ query }, session);
      await notifyCompanyManagers(query, { companyId: session.companyId, type: NOTIF.DP_DOC_SIGNED, entityType: 'candidate', entityId: session.candidateId, dedupeKey: `mobile:dp_doc_sig:${session.candidateId}:${docKey}:${result.item.signedAt}`, payload: { candidateId: session.candidateId, candidateName, name: candidateName, docKey } });
    } catch (error) { console.error('mobile employee signature notification', error?.message || error); }
    const home = await getEmployeeDpHome({ query }, session);
    if (!home.ok) return apiErrorFromResult(request, home);
    return NextResponse.json(home, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee dp signature', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
