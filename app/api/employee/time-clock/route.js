/**
 * GET  /api/employee/time-clock — today's punches + next kind
 * POST /api/employee/time-clock — punch in/out (location required)
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { query } from '../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee-session.js';
import { checkRateLimit } from '../../../../lib/rate-limit.js';
import { TIME_PUNCH_KINDS } from '../../../../lib/domain-status.js';
import { parsePunchCoordinates } from '../../../../lib/time-clock-format.js';
import {
  createTimePunch,
  getEmployeeTimeClockToday,
} from '../../../../lib/people/time-clock.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const data = await getEmployeeTimeClockToday({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!data.ok) return apiErrorFromResult(request, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/employee/time-clock', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;

    const rl = await checkRateLimit(`emp-punch:${candidateId}`, 40, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const punchKind = String(body.punchKind || '').toLowerCase();
    if (!TIME_PUNCH_KINDS.includes(punchKind)) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    const coords = parsePunchCoordinates(body.latitude, body.longitude);
    if (!coords) return apiError(request, ERR.GEOLOCATION_REQUIRED, 400);

    const result = await createTimePunch({ query }, {
      companyId,
      candidateId,
      punchKind,
      latitude: coords.latitude,
      longitude: coords.longitude,
      notes: body.notes,
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    const today = await getEmployeeTimeClockToday({ query }, { companyId, candidateId });
    return NextResponse.json({
      ok: true,
      punch: result.punch,
      day: today.ok ? today.day : result.day,
      punches: today.ok ? today.punches : null,
      nextKind: today.ok ? today.nextKind : null,
      open: today.ok ? today.open : null,
      schedule: today.ok ? today.schedule : null,
      lastLocation: today.ok ? today.lastLocation : null,
    });
  } catch (err) {
    console.error('POST /api/employee/time-clock', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
