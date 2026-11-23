import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR, HTTP_STATUS } from '../../../../../../../lib/api-error.js';
import { query } from '../../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../../lib/mobile/mobile-employee-session.js';
import { getTimeClockAccess } from '../../../../../../../lib/people/time-clock.js';
import { getEmployeeTimeMirror } from '../../../../../../../lib/people/time-clock-manager.js';
import { isValidTimeClockFormalMonth, missingTimeClockFormalMirrorFields } from '../../../../../../../lib/people/time-clock-formal-mirror.js';
import { REP_P_INPI_REGISTRATION } from '../../../../../../../lib/rep/provider.js';

export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

function formalPunch(punch) {
  return {
    id: punch.id,
    punchedAt: punch.punchedAt,
    punchKind: punch.punchKind,
    source: punch.source,
    notes: punch.notes || null,
    flag: punch.flag || null,
    voidedAt: punch.voidedAt || null,
    voidReason: punch.voidReason || null,
  };
}

export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);

    const url = new URL(request.url);
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    if (!isValidTimeClockFormalMonth(from, to)) {
      return apiError(request, ERR.INVALID_DATE, HTTP_STATUS.BAD_REQUEST);
    }

    const access = await getTimeClockAccess({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!access.ok) return apiErrorFromResult(request, access);
    if (!access.enabled) return apiError(request, ERR.TIME_CLOCK_DISABLED, HTTP_STATUS.FORBIDDEN);

    const mirror = await getEmployeeTimeMirror({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
      from,
      to,
    });
    if (!mirror.ok) return apiErrorFromResult(request, mirror);
    if (mirror.from !== from || mirror.to !== to) {
      return apiError(request, ERR.INVALID_DATE, HTTP_STATUS.BAD_REQUEST);
    }

    const identityResult = await query(
      `SELECT w.cpf, w.worker_name AS "registeredWorkerName", e.employer_name AS "employerName",
              e.employer_document AS "employerDocument",
              e.complementary_document AS "complementaryDocument",
              e.workplace, e.timezone
       FROM rep_workers w
       JOIN rep_establishments e
         ON e.id = w.establishment_id AND e.company_id = w.company_id
       WHERE w.company_id = $1 AND w.candidate_id = $2
       LIMIT 1`,
      [session.companyId, session.candidateId],
    );
    const identity = identityResult.rows[0] ? { ...identityResult.rows[0], registration: REP_P_INPI_REGISTRATION } : null;

    const missingFields = missingTimeClockFormalMirrorFields(mirror, identity);
    const timezone = mirror.schedule?.timezone || 'America/Sao_Paulo';
    const response = {
      ok: true,
      ready: missingFields.length === 0,
      from,
      to,
      issuedAt: new Date().toISOString(),
      timezone,
      missingFields,
    };
    if (missingFields.length) return NextResponse.json(response, { headers: NO_STORE });

    const days = [...mirror.days].sort((a, b) => a.day.localeCompare(b.day));
    const nightMinutes = days.reduce((sum, day) => sum + (Number(day.nightMinutes) || 0), 0);
    const nightEquivalentMinutes = days.reduce((sum, day) => sum + (Number(day.nightEquivalentMinutes) || 0), 0);
    response.employer = {
      name: identity.employerName,
      document: identity.employerDocument,
      complementaryDocument: identity.complementaryDocument || null,
      registration: identity.registration,
      workplace: identity.workplace || null,
    };
    response.worker = {
      name: identity.registeredWorkerName,
      cpf: identity.cpf,
      admission: mirror.person.startDate,
      jobRole: mirror.person.jobRoleName,
    };
    response.schedule = {
      workdayStart: mirror.schedule.workdayStart,
      workdayEnd: mirror.schedule.workdayEnd,
      breakStart: mirror.schedule.breakStart || null,
      breakEnd: mirror.schedule.breakEnd || null,
      breakMinutes: mirror.schedule.breakMinutes,
      breakPreassigned: Boolean(mirror.schedule.breakPreassigned),
      timezone,
    };
    response.summary = {
      workedMinutes: mirror.totals.workedMinutes,
      nightMinutes,
      nightEquivalentMinutes,
      nightAdjustedMinutes: mirror.totals.workedMinutes - nightMinutes + nightEquivalentMinutes,
    };
    response.days = days.map((day) => ({
      day: day.day,
      schedule: day.daySchedule,
      workedMinutes: day.workedMinutes,
      nightMinutes: day.nightMinutes,
      nightEquivalentMinutes: day.nightEquivalentMinutes,
      punches: (day.punches || []).map(formalPunch),
      preassignedMarks: (day.preassignedMarks || []).map(formalPunch),
      justification: day.justification ? {
        reason: day.justification.reason,
        excusedStart: day.justification.excusedStart || null,
        excusedEnd: day.justification.excusedEnd || null,
      } : null,
    }));
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (error) {
    console.error('GET mobile employee time clock formal mirror', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}
