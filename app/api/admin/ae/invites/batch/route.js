import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import {
  CAP,
  getManagerScope, resolveScopedCompanyId,
  getSessionPayload,
  publicAppUrl,
  requireCapability,
} from '../../../../../../lib/ae/require-admin';
import {
  BATCH_INVITE_CAP,
  batchCreateMotivatorsInvites,
  listInternalMotivatorsInviteRoster,
} from '../../../../../../lib/ae/batch-motivators-invites';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../lib/identity/rate-limit';
import { apiError, localeFromRequest, ERR } from '../../../../../../lib/api-error';
import { audit } from '../../../../../../lib/audit';


/** GET /api/admin/ae/invites/batch — roster interno elegível para convite em lote */
export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.MOTIVATORS_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const { searchParams } = new URL(request.url);
    const companyId = resolveScopedCompanyId(scope, searchParams.get('companyId'));
    if (!Number.isFinite(companyId)) {
      return apiError(request, ERR.INVALID_COMPANY, 400);
    }

    const roster = await listInternalMotivatorsInviteRoster(query, { companyId });
    return NextResponse.json({
      companyId,
      cap: BATCH_INVITE_CAP,
      ...roster,
      eligible: roster.items.filter((i) => i.eligible),
    });
  } catch (err) {
    console.error('GET /api/admin/ae/invites/batch', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/admin/ae/invites/batch — envia até BATCH_INVITE_CAP convites */
export async function POST(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.MOTIVATORS_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const scope = getManagerScope(payload);
    if (!scope.authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`ae-invite-batch:${payload?.userId || ip}`, 8, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_INVITES, 429);
    }

    const body = await request.json().catch(() => ({}));
    const companyId = resolveScopedCompanyId(scope, body.companyId);
    if (!Number.isFinite(companyId)) {
      return apiError(request, ERR.INVALID_COMPANY, 400);
    }

    const base = publicAppUrl(request);
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const result = await batchCreateMotivatorsInvites(query, {
      companyId,
      candidateIds: body.candidateIds,
      createdByUserId: payload?.userId,
      locale: localeFromRequest(request),
      appBaseUrl: base,
      definitionSlug: String(body.definitionSlug || 'motivators').trim(),
    });

    if (!result.ok) {
      return apiError(request, result.errorCode || 'INTERNAL', result.status || 400);
    }

    await audit({
      actorUserId: payload.userId || null,
      action: 'ae.invites.batch',
      targetType: 'company',
      targetId: String(companyId),
      metadata: {
        sent: result.sent.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
      },
    });

    return NextResponse.json({
      ok: true,
      cap: BATCH_INVITE_CAP,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      sentCount: result.sent.length,
      skippedCount: result.skipped.length,
      failedCount: result.failed.length,
    });
  } catch (err) {
    console.error('POST /api/admin/ae/invites/batch', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
