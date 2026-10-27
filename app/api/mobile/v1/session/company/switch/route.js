import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, HTTP_STATUS, ERR } from '../../../../../../../lib/api-error.js';
import {
  mobileEmployeeBearerToken,
  switchMobileEmployeeCompany,
} from '../../../../../../../lib/mobile/mobile-employee-session.js';
import { parseJsonBody } from '../../../../../../../lib/validate.js';

const switchSchema = z.object({
  candidateId: z.number().int().positive(),
  refreshToken: z.string().min(32).max(256),
});
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

export async function POST(request) {
  try {
    const parsed = await parseJsonBody(request, switchSchema);
    if (!parsed.ok) return parsed.response;
    const result = await switchMobileEmployeeCompany(
      mobileEmployeeBearerToken(request),
      parsed.data.refreshToken,
      parsed.data.candidateId
    );
    if (!result.ok) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('[mobile-employee-company-switch]', error);
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
