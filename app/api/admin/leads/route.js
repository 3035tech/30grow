import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/identity/auth.js';
import { query } from '../../../../lib/db.js';
import { apiError, ERR } from '../../../../lib/api-error.js';
import { CAP, requireCapability, isSuperAdminPayload } from '../../../../lib/identity/permissions.js';
import { verifySessionWithCapabilities } from '../../../../lib/identity/user-capabilities.js';
import { listEarlyAccessLeads } from '../../../../lib/admin-leads.js';

/**
 * GET /api/admin/leads
 * Super-admin only (admin sem company_id): early-access / self-service signup leads (cross-tenant).
 * Query: page, pageSize, status=all|pending|active|inactive, q=
 */
export async function GET(request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = await verifySessionWithCapabilities(token);
  if (!isSuperAdminPayload(payload) || !requireCapability(payload, CAP.USERS_MANAGE)) {
    return apiError(request, ERR.UNAUTHORIZED, 401);
  }

  try {
    const url = new URL(request.url);
    const data = await listEarlyAccessLeads({ query }, Object.fromEntries(url.searchParams.entries()));
    return Response.json(data);
  } catch (err) {
    console.error('GET /api/admin/leads', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
