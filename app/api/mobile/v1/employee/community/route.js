import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { listCompanyPosts } from '../../../../../../lib/company-posts.js';
import { mobileCommunityBody } from '../../../../../../lib/mobile-employee-payload.js';
import { createCompanyKudo, listCompanyKudos, searchEmployeeColleagues } from '../../../../../../lib/company-kudos.js';
import { EMPLOYEE_NOTIF, notifyCandidate } from '../../../../../../lib/employee-notifications.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { mobileIdempotencyKey } from '../../../../../../lib/mobile-idempotency.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const FEED_PAGE_SIZE = 10;
const KUDOS_PAGE_SIZE = 15;
const COLLEAGUE_LIMIT = 40;
const MAX_PAGE = 10000;
const pageSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(MAX_PAGE));
const pagesSchema = z.object({ postsPage: pageSchema.default(1), kudosPage: pageSchema.default(1), kudoId: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).optional() }).strict();
const KUDOS_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }
async function load(session, { postsPage = 1, kudosPage = 1, kudoId } = {}) {
  const [feed, kudos, colleagues] = await Promise.all([
    listCompanyPosts(null, { companyId: session.companyId, page: postsPage, pageSize: FEED_PAGE_SIZE }),
    listCompanyKudos(null, { companyId: session.companyId, viewerCandidateId: session.candidateId, page: kudoId ? 1 : kudosPage, pageSize: KUDOS_PAGE_SIZE, ...(kudoId ? { kudoId } : {}) }),
    searchEmployeeColleagues(null, { companyId: session.companyId, excludeCandidateId: session.candidateId, limit: COLLEAGUE_LIMIT }),
  ]);
  if (!feed.ok) return feed;
  if (!kudos.ok) return kudos;
  if (!colleagues.ok) return colleagues;
  return { ok: true, ...mobileCommunityBody({ posts: feed.posts, postTotal: feed.total, kudos: kudos.kudos, kudosTotal: kudos.total, colleagues: colleagues.people }),
    pagination: {
      posts: { page: postsPage, totalPages: Math.min(MAX_PAGE, Math.max(1, Math.ceil(feed.total / FEED_PAGE_SIZE))) },
      kudos: { page: kudosPage, totalPages: Math.min(MAX_PAGE, Math.max(1, Math.ceil(kudos.total / KUDOS_PAGE_SIZE))) },
    },
  };
}

export async function GET(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length > 1)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const pages = pagesSchema.safeParse(Object.fromEntries(params));
    if (!pages.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await load(session, pages.data);
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee community', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-employee-kudos:${session.candidateId}:${clientIpFromRequest(request)}`, KUDOS_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { 'Retry-After': String(limit.retryAfterSec) } });
    const body = await request.json().catch(() => ({}));
    const idempotencyKey = mobileIdempotencyKey(request);
    if (!idempotencyKey) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await createCompanyKudo(null, { companyId: session.companyId, fromCandidateId: session.candidateId, toCandidateId: body.toCandidateId, message: body.message, idempotencyKey });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    await notifyCandidate(null, { companyId: session.companyId, candidateId: result.kudo.toCandidateId, type: EMPLOYEE_NOTIF.KUDOS_RECEIVED, entityType: 'company_kudo', entityId: result.kudo.id, dedupeKey: `mobile:kudos:${result.kudo.id}`, payload: { fromName: result.kudo.fromName || '—', message: result.kudo.message } });
    const community = await load(session);
    if (!community.ok) return apiErrorFromResult(request, community);
    return NextResponse.json(community, { headers: NO_STORE });
  } catch (error) {
    console.error('POST mobile employee community', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
