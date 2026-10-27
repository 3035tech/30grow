import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { searchEmployeeColleagues } from '../../../../../../lib/company/company-kudos.js';
import { FEEDBACK_REQUEST_STATUS } from '../../../../../../lib/domain-status.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../../../lib/employee/employee-notifications.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile/mobile-employee-session.js';
import { answerFeedbackRequest, createFeedbackRequest, listFeedbackForSubject, listFeedbackInbox } from '../../../../../../lib/people/continuous-feedback.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit.js';
import { query } from '../../../../../../lib/db.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store, private' });
const FEEDBACK_ACTION = Object.freeze({ ANSWER: 'answer', REQUEST: 'request' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session) {
  const [inbox, aboutMe, colleagues] = await Promise.all([
    listFeedbackInbox(null, { companyId: session.companyId, toCandidateId: session.candidateId, status: FEEDBACK_REQUEST_STATUS.PENDING }),
    listFeedbackForSubject(null, { companyId: session.companyId, subjectCandidateId: session.candidateId, limit: 20 }),
    searchEmployeeColleagues(null, { companyId: session.companyId, excludeCandidateId: session.candidateId, q: '', limit: 30 }),
  ]);
  if (!inbox.ok || !aboutMe.ok || !colleagues.ok) return null;
  return { inbox: inbox.items, aboutMe: aboutMe.items, colleagues: colleagues.people.map((person) => ({ id: Number(person.id), fullName: person.fullName })) };
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const result = await load(session);
    if (!result) return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee feedback', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-feedback:${session.candidateId}:${clientIpFromRequest(request)}`, 30, 60 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const body = await request.json().catch(() => ({}));
    if (body.action === FEEDBACK_ACTION.ANSWER) {
      const id = Number(body.id);
      const owned = await query(`SELECT token FROM feedback_requests WHERE id = $1 AND company_id = $2 AND to_candidate_id = $3 LIMIT 1`, [id, session.companyId, session.candidateId]);
      if (!owned.rowCount) return apiError(request, ERR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);
      const answered = await answerFeedbackRequest(null, { token: owned.rows[0].token, responseText: body.responseText, answeredByCandidateId: session.candidateId });
      if (!answered.ok) return apiErrorFromResult(request, answered, { fallbackCode: ERR.INVALID_DATA });
    } else if (body.action === FEEDBACK_ACTION.REQUEST) {
      const requested = await createFeedbackRequest(null, { companyId: session.companyId, fromCandidateId: session.candidateId, toCandidateId: body.toCandidateId, subjectCandidateId: session.candidateId, prompt: body.prompt });
      if (!requested.ok) return apiErrorFromResult(request, requested, { fallbackCode: ERR.INVALID_DATA });
      try { await notifyCandidate({ companyId: session.companyId, candidateId: Number(body.toCandidateId), type: EMPLOYEE_NOTIF.FEEDBACK_REQUESTED, payload: { requestId: requested.request.id } }); } catch {}
    } else return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await load(session);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee feedback', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
