import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { listCandidateNotifications, markCandidateNotificationRead } from '../../../../../../lib/employee-notifications.js';
import { mobilePushDestinationFor, normalizeMobilePushDestinations, resolveMobilePushDestination } from '../../../../../../lib/mobile-employee-push.js';
import { mobileNotificationTarget } from '../../../../../../lib/mobile-notification-target.js';
import { getEmployeeProfile } from '../../../../../../lib/employee-profile.js';
import { t, normalizeLocale } from '../../../../../../lib/i18n.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const PAGE_SIZE = 40;
const MAX_PAGE = 10000;
const page = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(MAX_PAGE));
const querySchema = z.object({
  page: page.default(1),
  context: z.literal('1').optional(),
  notificationId: z.string().regex(/^[1-9]\d{0,17}$/).optional(),
  destinations: z.string().max(120).optional(),
}).strict();
const mutationSchema = z.union([
  z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ markAll: z.literal(true) }).strict(),
]);
function options(request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => params.getAll(key).length > 1)) return null;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  return parsed.success ? parsed.data : null;
}
async function responseFor(request, session, { page, context, notificationId, destinations }) {
  const profile = await getEmployeeProfile(null, session);
  const locale = normalizeLocale(profile.ok ? profile.person.preferredLocale : 'pt-BR');
  const supported = normalizeMobilePushDestinations(String(destinations || '').split(','));
  const result = await listCandidateNotifications(null, { companyId: session.companyId, candidateId: session.candidateId, limit: PAGE_SIZE, offset: notificationId ? 0 : (page - 1) * PAGE_SIZE, ...(notificationId ? { id: notificationId } : {}) });
  if (!result.ok) return apiErrorFromResult(request, result);
  return NextResponse.json({
    items: result.items.map((item) => ({ id: Number(item.id), title: t(locale, item.copy.titleKey, item.copy.values), body: t(locale, item.copy.bodyKey, item.copy.values), createdAt: new Date(item.createdAt).toISOString(), readAt: item.readAt ? new Date(item.readAt).toISOString() : null, destination: resolveMobilePushDestination(mobilePushDestinationFor(item.type), supported), ...(context ? { target: mobileNotificationTarget(item) } : {}) })),
    unreadCount: Number(result.unreadCount) || 0,
    pagination: { page, totalPages: Math.min(MAX_PAGE, Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE))) },
  }, { headers: NO_STORE });
}
export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const input = options(request);
    if (!input) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    return await responseFor(request, session, input);
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
export async function PATCH(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const input = options(request);
    const body = mutationSchema.safeParse(await request.json().catch(() => null));
    if (!input || !body.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await markCandidateNotificationRead(null, { companyId: session.companyId, candidateId: session.candidateId, ...body.data });
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return await responseFor(request, session, input);
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
