/**
 * GET  /api/public/whistleblowing/[token]
 * POST /api/public/whistleblowing/[token] — submit report (anonymous by default)
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../lib/db';
import { apiError, apiErrorFromResult, ERR } from '../../../../../lib/api-error';
import { audit, AUDIT_ACTOR_KIND, auditRequestContext } from '../../../../../lib/audit';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/identity/rate-limit';
import {
  resolveWhistleblowingChannelByToken,
  submitWhistleblowingReport,
} from '../../../../../lib/people/whistleblowing';

export async function GET(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-wb-get:${ip}`, 90, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    const resolved = await resolveWhistleblowingChannelByToken(query, params?.token);
    if (!resolved.ok) {
      return apiErrorFromResult(request, resolved, {
        fallbackCode: ERR.INVALID_TOKEN,
        fallbackStatus: 404,
      });
    }
    return NextResponse.json({
      title: resolved.channel.title,
      categories: resolved.categories,
    });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('GET public whistleblowing', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}

export async function POST(request, props) {
  const params = await props.params;
  try {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`public-wb-post:${ip}`, 20, 10 * 60 * 1000);
    if (!rl.ok) {
      return apiError(
        request,
        ERR.RATE_LIMIT,
        429,
        {},
        { headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }
    const body = await request.json().catch(() => ({}));
    const result = await submitWhistleblowingReport(query, {
      token: params?.token,
      category: body.category,
      body: body.body,
      anonymous: body.anonymous !== false,
      reporterCandidateId: null,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, {
        fallbackCode: ERR.INVALID_DATA,
        fallbackStatus: 400,
      });
    }
    await audit({
      actorKind: AUDIT_ACTOR_KIND.PUBLIC,
      action: 'whistleblowing.report_submit',
      companyId: null,
      targetType: 'whistleblowing_report',
      targetId: result.id,
      metadata: { anonymous: true },
      ...auditRequestContext(request),
    });
    return NextResponse.json({ ok: true, createdAt: result.createdAt });
  } catch (err) {
    if (err?.code === '42P01') return apiError(request, ERR.SCHEMA_NOT_INITIALIZED, 503);
    console.error('POST public whistleblowing', err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
