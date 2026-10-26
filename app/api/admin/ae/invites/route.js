import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { CAP, getManagerScope, getSessionPayload, publicAppUrl, requireCapability } from '../../../../../lib/ae/require-admin';
import { createAndQueueMotivatorsInvite, isValidInviteEmail } from '../../../../../lib/ae/create-motivators-invite';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import { apiError, localeFromRequest, ERR } from '../../../../../lib/api-error';
import { sqlAeInvitesOrderBy } from '../../../../../lib/ae/list-sort';

/** GET /api/admin/ae/invites — lista convites */
export async function GET(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.MOTIVATORS_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const { isAdmin, companyId, authorized } = getManagerScope(payload);
    if (!authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const { searchParams } = new URL(request.url);
    const status = String(searchParams.get('status') || '').trim();
    const companyFilter = String(searchParams.get('company') || '').trim();
    const q = String(searchParams.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(50, Math.max(10, parseInt(searchParams.get('pageSize') || '20', 10)));
    const offset = (page - 1) * pageSize;
    const orderBy = sqlAeInvitesOrderBy(searchParams.get('sort'), searchParams.get('sortDir'));

    const where = [];
    const params = [];
    let n = 1;

    if (!isAdmin) {
      where.push(`i.company_id = $${n++}`);
      params.push(companyId);
    } else if (companyFilter && companyFilter !== 'all') {
      where.push(`i.company_id = $${n++}`);
      params.push(Number(companyFilter));
    }

    if (status && status !== 'all') {
      where.push(`i.status = $${n++}`);
      params.push(status);
    }
    if (q) {
      where.push(`(LOWER(i.candidate_name) LIKE $${n} OR LOWER(i.candidate_email) LIKE $${n})`);
      params.push(`%${q}%`);
      n += 1;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS total FROM ae_invites i ${whereSql}`,
      params
    );
    const total = countRes.rows[0].total;

    const listRes = await query(
      `SELECT i.id, i.candidate_name AS "candidateName", i.candidate_email AS "candidateEmail",
              i.status, i.token, i.sent_at AS "sentAt", i.opened_at AS "openedAt",
              i.completed_at AS "completedAt", i.expires_at AS "expiresAt",
              i.reminder_count AS "reminderCount",
              c.name AS "companyName", c.id AS "companyId",
              d.name AS "definitionName"
       FROM ae_invites i
       JOIN companies c ON c.id = i.company_id
       JOIN ae_definitions d ON d.id = i.definition_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${n} OFFSET $${n + 1}`,
      [...params, pageSize, offset]
    );

    return NextResponse.json({ items: listRes.rows, total, page, pageSize });
  } catch (err) {
    console.error('GET /api/admin/ae/invites', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

/** POST /api/admin/ae/invites — cria convite */
export async function POST(request) {
  try {
    const payload = await getSessionPayload();
    if (!requireCapability(payload, CAP.MOTIVATORS_VIEW)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const { isAdmin, companyId, authorized } = getManagerScope(payload);
    if (!authorized) return apiError(request, ERR.UNAUTHORIZED, 401);

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`ae-invite:${payload?.userId || ip}`, 40, 60 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT_INVITES, 429);
    }

    const body = await request.json().catch(() => ({}));
    const candidateName = String(body.candidateName || body.name || '').trim();
    const candidateEmail = String(body.candidateEmail || body.email || '')
      .trim()
      .toLowerCase();
    const definitionSlug = String(body.definitionSlug || 'motivators').trim();
    let targetCompanyId = isAdmin ? Number(body.companyId) : Number(companyId);

    if (!candidateName || candidateName.length > 200) {
      return apiError(request, ERR.CANDIDATE_NAME_REQUIRED, 400);
    }
    if (!isValidInviteEmail(candidateEmail)) {
      return apiError(request, ERR.INVALID_EMAIL, 400);
    }
    if (!Number.isFinite(targetCompanyId)) {
      return apiError(request, ERR.INVALID_COMPANY, 400);
    }

    const base = publicAppUrl(request);
    if (!base) {
      return apiError(request, ERR.APP_URL_MISSING, 500);
    }

    const result = await createAndQueueMotivatorsInvite(query, {
      companyId: targetCompanyId,
      candidateName,
      candidateEmail,
      candidateId: body.candidateId != null ? Number(body.candidateId) : null,
      createdByUserId: payload?.userId,
      definitionSlug,
      locale: localeFromRequest(request),
      appBaseUrl: base,
    });

    if (!result.ok) {
      return apiError(request, result.errorCode, result.status || 400);
    }

    return NextResponse.json({
      ok: true,
      inviteId: result.inviteId,
      sentTo: result.sentTo,
      assessmentUrl: result.assessmentUrl,
      queued: true,
    });
  } catch (err) {
    console.error('POST /api/admin/ae/invites', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
