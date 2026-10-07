import { query, withTransaction } from '../../../../lib/db.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../lib/api-error.js';
import { verifyCronRequest } from '../../../../lib/cron-auth.js';
import { purgeAuditLog } from '../../../../lib/audit-retention.js';
import { audit, AUDIT_ACTOR_KIND } from '../../../../lib/audit.js';
export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
export async function POST(request) {
  if (!verifyCronRequest(request)) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
  try {
    const params = new URL(request.url).searchParams;
    const rawCursor = params.get('afterCompanyId') || '0';
    if (!/^\d{1,15}$/.test(rawCursor)) return apiError(request, ERR.INVALID_DATA, HTTP_STATUS.BAD_REQUEST, {}, { headers: NO_STORE });
    const afterCompanyId = Number(rawCursor);
    const execute = params.get('dryRun') === 'false';
    if (execute && process.env.AUDIT_RETENTION_EXECUTE !== '1') return apiError(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {}, { headers: NO_STORE });
    const result = await purgeAuditLog({ query, withTransaction }, { dryRun: !execute, afterCompanyId });
    await audit({ actorKind: AUDIT_ACTOR_KIND.SYSTEM, action: 'audit.retention.run', metadata: result });
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    console.error('audit retention failed', { code: error?.code || 'UNKNOWN' });
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
