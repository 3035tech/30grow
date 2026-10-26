import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../../../lib/admin-api.js';
import { CANDIDATE_ACCESS_CAPS } from '../../../../../../../lib/identity/permissions.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { checkRateLimit } from '../../../../../../../lib/identity/rate-limit.js';
import {
  analyzeCandidateProfile,
  applyCandidateProfile,
} from '../../../../../../../lib/recruiting/candidate-profile-import.js';
import { audit } from '../../../../../../../lib/audit.js';

export const runtime = 'nodejs';
export const maxDuration = 120;
const options = {
  anyCap: [...CANDIDATE_ACCESS_CAPS],
  companyFrom: 'none',
  requireCompany: false,
  logLabel: 'candidate profile import',
};

export const POST = withAdminApi(options, async ({ request, payload, scope, params }) => {
  const candidateId = Number(params.id);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0)
    return apiError(request, ERR.INVALID_ID, 400);
  const rl = await checkRateLimit(`cv-ai:${payload.userId}`, 6, 60_000);
  if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);
  const body = await request.json().catch(() => ({}));
  try {
    const result = await analyzeCandidateProfile({
      candidateId,
      scope,
      userId: payload.userId,
      locale: body.locale,
    });
    if (!result.ok) return apiErrorFromResult(request, result);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorFromResult(request, {
      errorCode: Object.values(ERR).includes(error?.code) ? error.code : ERR.RUBRIC_AI_FAILED,
    });
  }
});

export const PATCH = withAdminApi(options, async ({ request, payload, scope, params }) => {
  const candidateId = Number(params.id);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0)
    return apiError(request, ERR.INVALID_ID, 400);
  const body = await request.json().catch(() => ({}));
  let result;
  try {
    result = await applyCandidateProfile({ candidateId, scope, userId: payload.userId, body });
  } catch (error) {
    if (error?.code === '23505') return apiError(request, ERR.EMAIL_TAKEN, 409);
    throw error;
  }
  if (!result.ok) return apiErrorFromResult(request, result);
  await audit({
    actorUserId: payload.userId,
    companyId: result.companyId,
    action: 'candidate.profile_import',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: { fields: result.fields, source: 'cv_ai_reviewed' },
  });
  return NextResponse.json({ ok: true });
});
