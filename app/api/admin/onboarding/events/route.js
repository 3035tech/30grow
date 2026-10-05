import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/permissions.js';
import { recordOnboardingEvent } from '../../../../../lib/onboarding-funnel.js';
import { checkRateLimit } from '../../../../../lib/rate-limit.js';
import { z } from '../../../../../lib/validate.js';
import { ONBOARDING_EVENTS, ONBOARDING_OBJECTIVES, ONBOARDING_STEPS } from '../../../../../lib/domain-status.js';

const bodySchema = z.object({
  step: z.enum(/** @type {[string, ...string[]]} */ (ONBOARDING_STEPS)),
  event: z.enum(/** @type {[string, ...string[]]} */ (ONBOARDING_EVENTS)),
  objective: z.enum(/** @type {[string, ...string[]]} */ (ONBOARDING_OBJECTIVES)).optional().nullable(),
});

/**
 * POST /api/admin/onboarding/events — wizard funnel event (MVP-08).
 * Depth: app/api/admin/onboarding/events → 5× ../ até lib/
 */
export const POST = withAdminApi(
  {
    cap: CAP.PROFILE_SELF,
    requireCompany: false,
    companyFrom: 'none',
    body: bodySchema,
    logLabel: 'onboarding-events',
  },
  async ({ request, payload, body }) => {
    const companyId = payload?.companyId ?? null;
    // Super admin has no company and never sees the wizard: nothing to record.
    if (!companyId) return NextResponse.json({ ok: true, recorded: false });

    const rl = await checkRateLimit(`onboarding-events:${payload.userId}`, 60, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, httpStatusForError(ERR.RATE_LIMIT), {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec || 60) },
      });
    }

    const result = await recordOnboardingEvent({ query }, {
      companyId,
      userId: payload.userId,
      step: body.step,
      event: body.event,
      objective: body.objective ?? null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    return NextResponse.json({ ok: true, recorded: true });
  }
);
