import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { apiErrorFromResult, ERR } from '../../../../../lib/api-error.js';
import { query } from '../../../../../lib/db.js';
import { CAP } from '../../../../../lib/permissions.js';
import { DP_LEAVE_TYPES } from '../../../../../lib/domain-status.js';
import { z, zPositiveInt } from '../../../../../lib/validate.js';
import {
  createLeaveRequest,
  listLeaveCalendar,
  listLeaveRequests,
  getCompanyVacationPool,
} from '../../../../../lib/people/employee-dp.js';
import { notifyCandidate, EMPLOYEE_NOTIF } from '../../../../../lib/employee/employee-notifications.js';

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  candidateId: zPositiveInt,
  leaveType: z.enum(/** @type {[string, ...string[]]} */ (DP_LEAVE_TYPES)),
  startsOn: z.string().trim().min(8).max(32),
  endsOn: z.string().trim().min(8).max(32),
  reason: z.string().trim().max(2000).optional().nullable(),
  autoApprove: z.boolean().optional().default(true),
  allowOverBalance: z.boolean().optional().default(false),
});

/** GET /api/admin/dp/leave — company leave inbox + optional calendar / vacation pool */
export const GET = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    requireCompany: true,
    companyFrom: 'query',
    logLabel: 'dp-leave-list',
  },
  async ({ request, query: q, companyId }) => {
    const mode = String(q.mode || 'list');
    if (mode === 'calendar') {
      const data = await listLeaveCalendar({ query }, {
        companyId,
        from: q.from,
        to: q.to,
        limit: q.limit,
      });
      return NextResponse.json(data);
    }
    if (mode === 'pool') {
      const result = await getCompanyVacationPool({ query }, { companyId });
      if (!result.ok) {
        return apiErrorFromResult(request, result, { fallbackCode: ERR.COMPANY_REQUIRED });
      }
      return NextResponse.json({ ok: true, pool: result.pool });
    }
    const data = await listLeaveRequests({ query }, {
      ...q,
      companyId,
    });
    return NextResponse.json(data);
  }
);

/** POST /api/admin/dp/leave — RH registra ausência na fila da empresa */
export const POST = withAdminApi(
  {
    anyCap: [CAP.DP_VIEW, CAP.TEAM_VIEW],
    body: createBodySchema,
    requireCompany: true,
    companyFrom: 'body',
    logLabel: 'dp-leave-create',
  },
  async ({ request, body, companyId, payload }) => {
    const result = await createLeaveRequest({ query }, {
      companyId,
      candidateId: body.candidateId,
      leaveType: body.leaveType,
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      reason: body.reason,
      requestedBy: 'manager',
      autoApprove: body.autoApprove !== false,
      allowOverBalance: body.allowOverBalance === true,
      userId: payload.userId,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }

    try {
      await notifyCandidate({
        companyId,
        candidateId: body.candidateId,
        type: EMPLOYEE_NOTIF.DP_LEAVE_UPDATE,
        payload: {
          leaveId: result.item.id,
          status: result.item.status,
          leaveType: result.item.leaveType,
        },
      });
    } catch (e) {
      console.error('[dp] employee leave notif', e?.message || e);
    }

    return NextResponse.json({ ok: true, item: result.item }, { status: 201 });
  }
);
