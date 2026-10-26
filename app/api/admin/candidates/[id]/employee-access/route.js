import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../lib/admin-api.js';
import { CAP } from '../../../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../../../lib/validate.js';
import { query } from '../../../../../../lib/db.js';
import { issueEmployeePasswordInvite } from '../../../../../../lib/employee-auth.js';
import { checkRateLimit } from '../../../../../../lib/rate-limit.js';
import { audit } from '../../../../../../lib/audit.js';
import { EMPLOYMENT_STATUS } from '../../../../../../lib/domain-status.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  locale: zLocale.optional(),
});

/** POST /api/admin/candidates/[id]/employee-access — invite set-password email */
export const POST = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    body: bodySchema,
    requireCompany: false,
    logLabel: 'employee access POST',
  },
  async ({ request, payload, scope, body, params }) => {
    const candidateId = parseInt(String(params?.id || ''), 10);
    if (!Number.isFinite(candidateId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const owned = await query(
      `SELECT id, email, company_id AS "companyId", employment_status AS "employmentStatus"
       FROM candidates WHERE id = $1 AND ($2::integer IS NULL OR company_id = $2) LIMIT 1`,
      [candidateId, scope.isAdmin ? null : scope.companyId]
    );
    if (owned.rowCount === 0) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.NOT_FOUND });
    }
    const companyId = owned.rows[0].companyId;
    if (body.companyId != null && Number(body.companyId) !== Number(companyId)) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.FORBIDDEN });
    }
    if (owned.rows[0].employmentStatus !== EMPLOYMENT_STATUS.EMPLOYEE) {
      return apiErrorFromResult(request, { ok: false, errorCode: ERR.INVALID_DATA });
    }
    const rate = await checkRateLimit(`employee-access-invite:${payload.userId}:${companyId}`, 120, 15 * 60 * 1000);
    if (!rate.ok) return apiErrorFromResult(request, { ok: false, errorCode: ERR.RATE_LIMIT });
    const result = await issueEmployeePasswordInvite(query, {
      candidateId,
      companyId,
      locale: body.locale || 'pt-BR',
      purpose: 'invite',
      requireMail: true,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    await audit({
      actorUserId: payload.userId || null,
      companyId,
      action: 'employee.access_invite',
      targetType: 'candidate',
      targetId: String(candidateId),
      metadata: { companyId },
    });
    return NextResponse.json({ ok: true, sent: Boolean(result.sent) });
  }
);
