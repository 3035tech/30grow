import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../lib/api-error.js';
import { z, zLocale, zPositiveInt } from '../../../../lib/validate.js';
import { createEmployeeDirect } from '../../../../lib/recruiting/hire.js';
import { audit } from '../../../../lib/audit.js';
import { checkRateLimit } from '../../../../lib/identity/rate-limit.js';
import { ONBOARDING_STAGES } from '../../../../lib/development/onboarding-stage-selection.js';
import { normalizeStartDate } from '../../../../lib/recruiting/pipeline.js';

const bodySchema = z.object({
  companyId: zPositiveInt.optional(),
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  personalEmail: z.string().trim().email().max(254).optional().nullable(),
  startDate: z.string().trim().max(10).refine(value => !value || Boolean(normalizeStartDate(value))).optional().nullable(),
  entryMode: z.enum(['new_hire','existing_employee']).default('new_hire'),
  sendAccessInvite: z.boolean().optional().default(false),
  onboardingStages: z.array(z.enum(ONBOARDING_STAGES)).max(4).refine(stages => new Set(stages).size === stages.length).optional(),
  locale: zLocale.optional(),
});

/**
 * POST /api/admin/employees — include collaborator without vacancy (B-RH2-06).
 * Depth: app/api/admin/employees → 4× ../ até lib/
 */
export const POST = withAdminApi(
  {
    cap: CAP.TEAM_VIEW,
    body: bodySchema,
    companyFrom: 'body',
    logLabel: 'employees POST',
  },
  async ({ request, payload, companyId, body }) => {
    const rl = await checkRateLimit(
      `admin-employees-create:${payload.userId || 'anon'}`,
      30,
      15 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT));
    }

    const result = await createEmployeeDirect({
      companyId,
      fullName: body.fullName,
      email: body.email,
      personalEmail: body.personalEmail,
      entryMode: body.entryMode,
      startDate: body.startDate || null,
      createdByUserId: payload.userId || null,
      sendAccessInvite: Boolean(body.sendAccessInvite),
      onboardingStages: body.onboardingStages,
      locale: body.locale || 'pt-BR',
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }

    await audit({
      actorUserId: payload.userId || null,
      companyId,
      action: 'employee.create_direct',
      targetType: 'candidate',
      targetId: String(result.candidateId),
      metadata: {
        startDate: result.startDate,
        inviteSent: result.inviteSent,
        inviteErrorCode: result.inviteErrorCode || null,
        onboardingStages: body.onboardingStages || null,
        entryMode: body.entryMode,
      },
    });

    return NextResponse.json({
      ok: true,
      candidateId: result.candidateId,
      startDate: result.startDate,
      inviteSent: result.inviteSent,
      inviteErrorCode: result.inviteErrorCode || null,
    });
  }
);
