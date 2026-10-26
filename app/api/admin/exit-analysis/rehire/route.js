import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../../lib/validate.js';
import { rehireEmployee } from '../../../../../lib/recruiting/hire.js';
import { audit } from '../../../../../lib/audit.js';
import { checkRateLimit } from '../../../../../lib/identity/rate-limit.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
  corporateEmail: z.string().trim().email().max(254).optional().nullable(),
  rehireDate: z.string().trim().max(10).optional().nullable(),
  sendAccessInvite: z.boolean().optional().default(false),
  locale: zLocale.optional(),
});

/**
 * POST /api/admin/exit-analysis/rehire — reactivate an alumni, keeping the exit as history.
 * Depth: app/api/admin/exit-analysis/rehire → 5× ../ até lib/
 */
export const POST = withAdminApi(
  {
    cap: CAP.EXIT_ANALYSIS_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'exit-analysis rehire POST',
  },
  async ({ request, payload, companyId, body }) => {
    const rl = await checkRateLimit(
      `admin-rehire:${payload.userId || 'anon'}`,
      30,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));
    }

    const result = await rehireEmployee({
      companyId,
      candidateId: body.candidateId,
      rehireDate: body.rehireDate || null,
      corporateEmail: body.corporateEmail || null,
      rehiredByUserId: payload.userId || null,
      sendAccessInvite: Boolean(body.sendAccessInvite),
      locale: body.locale || 'pt-BR',
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.UPDATE_FAILED });
    }

    await audit({
      actorUserId: payload.userId || null,
      companyId,
      action: 'employee.rehire',
      targetType: 'candidate',
      targetId: String(result.candidateId),
      metadata: {
        rehireDate: result.rehireDate,
        inviteSent: result.inviteSent,
        inviteErrorCode: result.inviteErrorCode || null,
      },
    });

    return NextResponse.json({
      ok: true,
      candidateId: result.candidateId,
      rehireDate: result.rehireDate,
      inviteSent: result.inviteSent,
      inviteErrorCode: result.inviteErrorCode || null,
    });
  }
);
