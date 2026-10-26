/**
 * GET  /api/employee/hour-bank — balance + recent entries
 * POST /api/employee/hour-bank — request debit (comp time)
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { query } from '../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../lib/employee/employee-session.js';
import { checkRateLimit } from '../../../../lib/rate-limit.js';
import {
  getEmployeeHourBankHome,
  requestHourBankDebit,
} from '../../../../lib/people/hour-bank.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const data = await getEmployeeHourBankHome({ query }, {
      companyId: session.companyId,
      candidateId: session.candidateId,
    });
    if (!data.ok) return apiErrorFromResult(request, data);
    return NextResponse.json(data);
  } catch (err) {
    console.error('GET /api/employee/hour-bank', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { candidateId, companyId } = session;

    const rl = await checkRateLimit(`emp-hour-bank:${candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const result = await requestHourBankDebit({ query }, {
      companyId,
      candidateId,
      minutes: body.minutes,
      workOn: body.workOn,
      note: body.note || '',
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    const home = await getEmployeeHourBankHome({ query }, { companyId, candidateId });
    return NextResponse.json({
      ok: true,
      entry: result.entry,
      balanceMinutes: home.ok ? home.balanceMinutes : null,
      items: home.ok ? home.items : null,
      enabled: home.ok ? home.enabled : null,
      maxMinutes: home.ok ? home.maxMinutes : null,
    });
  } catch (err) {
    console.error('POST /api/employee/hour-bank', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
