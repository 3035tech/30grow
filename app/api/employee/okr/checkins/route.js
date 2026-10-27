/**
 * POST /api/employee/okr/checkins — assignee check-in on linked activity
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { getEmployeeSessionPayload } from '../../../../../lib/employee/employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit.js';
import { createOkrActivityCheckin } from '../../../../../lib/development/okr-cycles.js';
import { recordKeyResultCheckin } from '../../../../../lib/development/okr-hierarchy.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';

export const dynamic = 'force-dynamic';

const bodySchema = z.union([z.object({
  keyResultId: zPositiveInt,
  currentValue: z.number().finite(),
  note: z.string().trim().max(500).optional(),
}), z.object({
  activityId: zPositiveInt,
  progressPct: z.coerce.number().int().min(0).max(100),
  note: z.string().trim().max(500).optional().nullable(),
})]);

export async function POST(request) {
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `emp-okr-checkin:${session.candidateId}:${ip}`,
      30,
      60 * 60 * 1000
    );
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const raw = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(request, ERR.INVALID_DATA, 400);
    }

    const result = parsed.data.keyResultId ? await recordKeyResultCheckin(null, {
      ...parsed.data, companyId:session.companyId, candidateId:session.candidateId,
    }) : await createOkrActivityCheckin(null, {
      companyId: session.companyId,
      activityId: parsed.data.activityId,
      progressPct: parsed.data.progressPct,
      note: parsed.data.note,
      createdByCandidateId: session.candidateId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UNAUTHORIZED });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('POST /api/employee/okr/checkins', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
