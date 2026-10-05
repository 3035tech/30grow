import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { apiError, apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { query } from '../../../../lib/db.js';
import { CAP, isSuperAdminPayload, requireCapability } from '../../../../lib/permissions.js';
import {
  createProductFeedback,
  listFeedbackAssignees,
  listProductFeedback,
  summarizeProductFeedback,
} from '../../../../lib/product-feedback.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../lib/rate-limit.js';
import { z } from '../../../../lib/validate.js';
import { PRODUCT_FEEDBACK_KINDS, PRODUCT_FEEDBACK_SEVERITIES } from '../../../../lib/domain-status.js';

const createBodySchema = z.object({
  kind: z.enum(/** @type {[string, ...string[]]} */ (PRODUCT_FEEDBACK_KINDS)),
  message: z.string().trim().min(10).max(4000),
  severity: z.enum(/** @type {[string, ...string[]]} */ (PRODUCT_FEEDBACK_SEVERITIES)).optional(),
  activeTab: z.string().trim().max(80).optional().nullable(),
  activeSection: z.string().trim().max(80).optional().nullable(),
  contactOk: z.boolean().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
  kind: z.string().optional(),
  severity: z.string().optional(),
  module: z.string().optional(),
  overdue: z.string().optional(),
  q: z.string().optional(),
});

/**
 * POST — any authenticated manager submits feedback.
 * GET — super-admin inbox (cross-tenant).
 */
export const POST = withAdminApi(
  {
    cap: CAP.PROFILE_SELF,
    requireCompany: false,
    companyFrom: 'none',
    body: createBodySchema,
    logLabel: 'product-feedback-create',
  },
  async ({ request, payload, body, scope }) => {
    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(
      `product-feedback:${payload.userId || ip}`,
      12,
      60 * 60 * 1000
    );
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, {
        headers: { 'Retry-After': String(rl.retryAfterSec || 60) },
      });
    }

    const companyId = scope?.companyId ?? payload?.companyId ?? payload?.company_id ?? null;
    const result = await createProductFeedback({ query }, {
      companyId,
      userId: payload.userId,
      kind: body.kind,
      message: body.message,
      severity: body.severity,
      activeTab: body.activeTab,
      activeSection: body.activeSection,
      contactOk: body.contactOk,
    });
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.INVALID_DATA });
    }
    return NextResponse.json({ ok: true, id: result.id, createdAt: result.createdAt, responseDueAt: result.responseDueAt });
  }
);

export const GET = withAdminApi(
  {
    cap: CAP.USERS_MANAGE,
    requireCompany: false,
    companyFrom: 'none',
    query: listQuerySchema,
    logLabel: 'product-feedback-list',
  },
  async ({ request, payload, query: q }) => {
    if (!isSuperAdminPayload(payload) || !requireCapability(payload, CAP.USERS_MANAGE)) {
      return apiError(request, ERR.UNAUTHORIZED, 401);
    }
    const db = { query };
    const [data, summary, assignees] = await Promise.all([
      listProductFeedback(db, q),
      summarizeProductFeedback(db),
      listFeedbackAssignees(db),
    ]);
    return NextResponse.json({ ...data, summary, assignees });
  }
);
