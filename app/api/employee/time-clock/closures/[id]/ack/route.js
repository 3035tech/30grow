/**
 * POST /api/employee/time-clock/closures/[id]/ack — sign (typed name + consent) or dispute a mirror.
 * Body: { action: 'signed' | 'disputed', signerName?, consent?, note? }
 */

import { NextResponse } from 'next/server';
import { apiError, apiErrorFromResult, ERR } from '../../../../../../../lib/api-error.js';
import { audit, auditRequestContext, AUDIT_ACTOR_KIND } from '../../../../../../../lib/audit.js';
import { query } from '../../../../../../../lib/db.js';
import { getEmployeeSessionPayload } from '../../../../../../../lib/employee-session.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../../../lib/rate-limit.js';
import { TIME_CLOCK_ACK_STATUS } from '../../../../../../../lib/domain-status.js';
import { getEmployeeDisplayName } from '../../../../../../../lib/people/employee-dp.js';
import {
  acknowledgeClosure,
  notifyClosureDisputed,
} from '../../../../../../../lib/people/time-clock-closure-people.js';

export const dynamic = 'force-dynamic';

export async function POST(request, props) {
  const params = await props.params;
  try {
    const session = await getEmployeeSessionPayload();
    if (!session) return apiError(request, ERR.UNAUTHORIZED, 401);
    const { companyId, candidateId } = session;
    const closureId = Number(params?.id);
    if (!Number.isFinite(closureId) || closureId <= 0) return apiError(request, ERR.INVALID_ID, 400);

    const rl = await checkRateLimit(`emp-tc-ack:${candidateId}`, 20, 60 * 60 * 1000);
    if (!rl.ok) return apiError(request, ERR.RATE_LIMIT, 429);

    const body = await request.json().catch(() => ({}));
    const result = await acknowledgeClosure({ query }, {
      companyId,
      candidateId,
      closureId,
      action: body?.action,
      signerName: body?.signerName,
      consent: body?.consent === true,
      note: body?.note,
      signerIp: clientIpFromRequest(request),
      signerUserAgent: String(request.headers.get('user-agent') || '').slice(0, 300),
    });
    if (!result.ok) return apiErrorFromResult(request, result);

    const disputed = result.item.ackStatus === TIME_CLOCK_ACK_STATUS.DISPUTED;
    await audit({
      actorCandidateId: candidateId,
      actorKind: AUDIT_ACTOR_KIND.EMPLOYEE,
      companyId,
      action: disputed ? 'time_clock.mirror_disputed' : 'time_clock.mirror_signed',
      targetType: 'time_clock_closure',
      targetId: closureId,
      metadata: { periodStart: result.item.periodStart, periodEnd: result.item.periodEnd },
      ...auditRequestContext(request),
    });

    if (disputed) {
      try {
        const name = await getEmployeeDisplayName({ query }, { companyId, candidateId });
        await notifyClosureDisputed(query, { companyId, candidateId, candidateName: name, item: result.item });
      } catch (e) {
        console.error('[time-clock] dispute notif', e?.message || e);
      }
    }

    return NextResponse.json({ ok: true, item: result.item });
  } catch (err) {
    console.error('POST /api/employee/time-clock/closures/[id]/ack', err?.message || err);
    return apiError(request, ERR.INTERNAL, 500);
  }
}
