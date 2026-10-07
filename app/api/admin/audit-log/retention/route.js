import { cookies } from 'next/headers';
import { z } from 'zod';
import { COOKIE_NAME } from '../../../../../lib/auth.js';
import { query, withTransaction } from '../../../../../lib/db.js';
import { apiError, ERR, HTTP_STATUS } from '../../../../../lib/api-error.js';
import { verifySessionWithCapabilities } from '../../../../../lib/user-capabilities.js';
import { CAP, can, isSuperAdminPayload } from '../../../../../lib/permissions.js';
import { parseJsonBody } from '../../../../../lib/validate.js';
export const dynamic = 'force-dynamic';
const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });
const schema = z.object({
  companyId: z.number().int().positive().safe(),
  retentionDays: z.number().int().min(1).max(36500),
  securityRetentionDays: z.number().int().min(1).max(36500),
  approvalReference: z.string().trim().min(1).max(200),
  legalHold: z.boolean(),
  holdReference: z.string().trim().min(1).max(200).nullable(),
}).strict().refine((v) => v.securityRetentionDays >= v.retentionDays && (!v.legalHold || v.holdReference), { message: 'Invalid retention policy' });

export async function POST(request) {
  try {
    const payload = await verifySessionWithCapabilities((await cookies()).get(COOKIE_NAME)?.value);
    if (!payload) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    if (!isSuperAdminPayload(payload) || !can(payload, CAP.AUDIT_VIEW)) return apiError(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {}, { headers: NO_STORE });
    const input = await parseJsonBody(request, schema);
    if (!input.ok) {
      input.response.headers.set('Cache-Control', 'no-store');
      return input.response;
    }
    const v = input.data;
    const exists = await query('SELECT id FROM companies WHERE id = $1 AND deleted = FALSE', [v.companyId]);
    if (!exists.rowCount) return apiError(request, ERR.NOT_FOUND, HTTP_STATUS.NOT_FOUND, {}, { headers: NO_STORE });
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO audit_retention_policies
        (company_id, retention_days, security_retention_days, approval_reference, approved_by_user_id, legal_hold, hold_reference)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (company_id) DO UPDATE SET retention_days = EXCLUDED.retention_days,
        security_retention_days = EXCLUDED.security_retention_days, approval_reference = EXCLUDED.approval_reference,
        approved_by_user_id = EXCLUDED.approved_by_user_id, approved_at = NOW(), legal_hold = EXCLUDED.legal_hold,
        hold_reference = EXCLUDED.hold_reference, updated_at = NOW()`,
      [v.companyId, v.retentionDays, v.securityRetentionDays, v.approvalReference, payload.userId, v.legalHold, v.holdReference]);
      // Policy and its evidence commit atomically. Never store case content, only reference IDs.
      await client.query(`INSERT INTO audit_log (actor_user_id, actor_kind, company_id, action, target_type, target_id, metadata)
        VALUES ($1,'manager',$2,'audit.retention.policy','company',$2::text,$3::jsonb)`,
      [payload.userId, v.companyId, JSON.stringify({ retentionDays: v.retentionDays, securityRetentionDays: v.securityRetentionDays, legalHold: v.legalHold })]);
    });
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('audit policy failed', { code: error?.code || 'UNKNOWN' });
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}

export async function GET(request) {
  try {
    const payload = await verifySessionWithCapabilities((await cookies()).get(COOKIE_NAME)?.value);
    if (!payload) return apiError(request, ERR.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, {}, { headers: NO_STORE });
    if (!isSuperAdminPayload(payload) || !can(payload, CAP.AUDIT_VIEW)) return apiError(request, ERR.FORBIDDEN, HTTP_STATUS.FORBIDDEN, {}, { headers: NO_STORE });
    const result = await query('SELECT * FROM audit_retention_policies ORDER BY company_id LIMIT 500');
    return Response.json({ policies: result.rows, truncated: result.rows.length === 500 }, { headers: NO_STORE });
  } catch {
    return apiError(request, ERR.INTERNAL, HTTP_STATUS.INTERNAL_SERVER_ERROR, {}, { headers: NO_STORE });
  }
}
