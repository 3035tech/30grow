import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, ERR, HTTP_STATUS } from '../../../../../../lib/api-error.js';
import { MOBILE_PUSH_PLATFORM, registerMobileEmployeePushToken, unregisterMobileEmployeePushToken } from '../../../../../../lib/mobile-employee-push.js';
import { authenticateMobileEmployee, mobileEmployeeBearerToken } from '../../../../../../lib/mobile-employee-session.js';
import { parseJsonBody } from '../../../../../../lib/validate.js';

const tokenSchema = z.object({
  pushToken: z.string().trim().min(20).max(256),
  platform: z.enum(MOBILE_PUSH_PLATFORM).optional(),
  appVersion: z.string().trim().max(32).optional(),
  destinations: z.array(z.string().trim().max(32)).max(16).optional(),
});
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
async function auth(request) { return authenticateMobileEmployee(mobileEmployeeBearerToken(request)); }

export async function POST(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const parsed = await parseJsonBody(request, tokenSchema.required({ platform: true }));
    if (!parsed.ok) return parsed.response;
    const result = await registerMobileEmployeePushToken(null, { candidateId: session.candidateId, companyId: session.companyId, ...parsed.data });
    if (!result.ok) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    return NextResponse.json({ ok: true, destinations: result.destinations }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-push-token-register]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}

export async function DELETE(request) {
  try {
    const session = await auth(request);
    if (!session) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const parsed = await parseJsonBody(request, tokenSchema.pick({ pushToken: true }));
    if (!parsed.ok) return parsed.response;
    await unregisterMobileEmployeePushToken(null, { candidateId: session.candidateId, companyId: session.companyId, pushToken: parsed.data.pushToken });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-push-token-unregister]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
