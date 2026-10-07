import { cookies } from 'next/headers';
import { COOKIE_NAME } from '../../../../lib/auth.js';
import { query } from '../../../../lib/db.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../lib/api-error.js';
import { verifySessionWithCapabilities } from '../../../../lib/user-capabilities.js';
import { listAuditLogEntries } from '../../../../lib/audit-log-admin.js';
import { auditAccess, tenantAuditEntry, auditCsv } from '../../../../lib/audit-access.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { auditFromRequest } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request) {
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const payload = await verifySessionWithCapabilities(token);
    if (!payload) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    const access = auditAccess(payload);
    if (!access) return apiError(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {}, { headers: NO_STORE });
    const params = new URL(request.url).searchParams;
    const options = Object.fromEntries(params);
    // The owner scope always wins over query-string companyId, including companyId=all.
    if (access.tenantOnly) options.companyId = String(access.companyId);
    const exporting = params.get('format') === 'csv';
    if (exporting) {
      const limit = await checkRateLimit(`audit-export:${payload.userId}:${clientIpFromRequest(request)}`, 10, 10 * 60 * 1000);
      if (!limit.ok) return apiError(request, ERR.RATE_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, {}, { headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSec) } });
    }
    const data = await listAuditLogEntries({ query }, { ...options, export: exporting });
    if (access.tenantOnly) data.items = data.items.map(tenantAuditEntry);
    if (!exporting) return Response.json(data, { headers: NO_STORE });
    await auditFromRequest(request, { actorUserId: payload.userId, companyId: access.companyId || Number(options.companyId) || null, action: 'audit.export', targetType: 'audit_log', metadata: { rows: data.items.length, truncated: data.truncated } });
    return new Response(auditCsv(data.items), { headers: { ...NO_STORE, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"', 'X-Export-Truncated': String(Boolean(data.truncated)) } });
  } catch (error) {
    console.error('audit listing failed', { code: error?.code || 'UNKNOWN' });
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
