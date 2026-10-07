import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { dismissEmployeeWelcome, getEmployeeHome } from '../../../../../../lib/employee-home.js';
import { t, normalizeLocale } from '../../../../../../lib/i18n.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { getTimeClockAccess } from '../../../../../../lib/people/time-clock.js';
import { getEmployeeProfile } from '../../../../../../lib/employee-profile.js';
import { getCompanyEnabledModules } from '../../../../../../lib/company-module-entitlements.js';
import { z } from 'zod';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const dismissSchema = z.object({ action: z.literal('dismissWelcome') }).strict();
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const [profile, companyModules] = await Promise.all([
      getEmployeeProfile(null, session),
      getCompanyEnabledModules(null, session.companyId),
    ]);
    if (!profile.ok) return apiErrorFromResult(request, profile, { init: { headers: NO_STORE } });
    const locale = normalizeLocale(new URL(request.url).searchParams.get('locale') || profile.person.preferredLocale);
    const home = await getEmployeeHome(null, { companyId: session.companyId, candidateId: session.candidateId, locale });
    if (!home.ok) return apiErrorFromResult(request, home, { fallbackCode: ERR.UNAUTHORIZED, init: { headers: NO_STORE } });
    const pdiItems = home.plans.reduce((total, plan) => total + plan.items.filter((item) => item.status !== 'done').length, 0);
    const onboardingPending = home.journey
      ? [...(home.journey.preItems || []), ...(home.journey.checkins || [])].filter((item) => !item.completedAt && item.status !== 'done').length
      : 0;
    const timeClock = await getTimeClockAccess(null, { companyId: session.companyId, candidateId: session.candidateId });
    return NextResponse.json({
      locale,
      showWelcome: Boolean(home.showWelcome),
      companyModules,
      person: { fullName: home.person.fullName },
      company: { name: home.company.name, aboutHtml: home.company.aboutHtml, website: home.company.website },
      tasks: home.tasks.slice(0, 20).map((task) => ({
        id: String(task.id),
        kind: String(task.kind),
        title: t(home.locale, task.titleKey, task.titleValues || {}),
        dueDate: task.dueDate || task.expiresAt || null,
      })),
      features: { timeClock: Boolean(timeClock.ok && timeClock.enabled) },
      summary: { courses: home.courses.filter((course) => !course.isComplete).length, onboardingPending, okrs: home.okrActivities.length, pdiItems },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee home', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}

export async function POST(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const limit = await checkRateLimit(`mobile-welcome:${session.companyId}:${session.candidateId}:${clientIpFromRequest(request)}`, 60, 10 * 60 * 1000);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSec) } });
    if (!dismissSchema.safeParse(await request.json().catch(() => null)).success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    const result = await dismissEmployeeWelcome(null, session);
    if (!result.ok) return apiErrorFromResult(request, result, { init: { headers: NO_STORE } });
    return NextResponse.json({ ok: true, showWelcome: false }, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
