import { NextResponse } from 'next/server';
import { z } from 'zod';
import { zLocale } from '../../../../../../lib/validate.js';
import { normalizeLocale } from '../../../../../../lib/locale-negotiation.js';
import { apiError, apiErrorFromResult, HTTP_STATUS, ERR } from '../../../../../../lib/api-error.js';
import { withTransaction } from '../../../../../../lib/db.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { listEmployeeMotivators, changeEmployeeMotivators, MotivatorsAction } from '../../../../../../lib/employee/employee-motivators.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/rate-limit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_ANSWERS = 200;
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const id = z.string().regex(/^[1-9]\d{0,17}$/);
const locale = zLocale;
const answer = z.union([
  z.object({ questionId: id, optionId: id }).strict(),
  z.object({ questionId: id, ranking: z.array(id).min(1).max(MAX_ANSWERS) }).strict(),
  z.object({ questionId: id, likertValue: z.number().int().min(1).max(5) }).strict(),
]);
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal(MotivatorsAction.Start), inviteId: id, areaKey: z.string().min(1).max(100), consent: z.literal(true), locale }).strict(),
  z.object({ action: z.literal(MotivatorsAction.Submit), attemptId: id, answers: z.array(answer).min(1).max(MAX_ANSWERS), locale }).strict(),
]);
export async function GET(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const loc = normalizeLocale(new URL(request.url).searchParams.get('locale'));
    return NextResponse.json(await listEmployeeMotivators(null, { ...session, locale: loc }), { headers: NO_STORE });
  } catch { return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR); }
}
export async function POST(request) {
  try {
    const session = await authenticateMobileEmployee(mobileEmployeeBearerToken(request));
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
    const limit = await checkRateLimit(`mobile-motivators:${session.companyId}:${session.candidateId}:${clientIpFromRequest(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    let body; try { body = JSON.parse(raw); } catch { return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST); }
    const input = inputSchema.safeParse(body);
    if (!input.success) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST);
    const result = await withTransaction((db) => changeEmployeeMotivators(db, session, input.data));
    if (!result.ok) return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch { return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR); }
}
