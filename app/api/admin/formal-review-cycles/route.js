import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../lib/admin-api.js';
import { CAP } from '../../../../lib/ae/require-admin.js';
import { apiErrorFromResult, ERR } from '../../../../lib/api-error.js';
import { z, zPositiveInt } from '../../../../lib/validate.js';
import { FORMAL_REVIEW_MODELS } from '../../../../lib/domain-status.js';
import {
  listFormalReviewCycles,
  createFormalReviewCycle,
} from '../../../../lib/people/formal-competency-reviews.js';
import { audit } from '../../../../lib/audit.js';
import { withTransaction } from '../../../../lib/db.js';

const listQuerySchema = z.object({
  companyId: zPositiveInt.optional(),
  limit: z.coerce.number().int().min(1).max(40).optional().default(40),
});

const createBodySchema = z.object({
  companyId: zPositiveInt.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  model: z.enum(/** @type {[string, ...string[]]} */ (FORMAL_REVIEW_MODELS)).optional().default('90'),
  includeSelf: z.boolean().optional().default(false),
  periodStart: z.string().trim().max(10).optional().nullable(),
  periodEnd: z.string().trim().max(10).optional().nullable(),
  competencyIds: z.array(zPositiveInt).max(30).optional().default([]),
  questionnaire: z.array(z.object({ competencyId: zPositiveInt, selfDescription: z.string().max(4000) }).strict()).max(30).optional(),
  instructions: z.string().trim().max(4000).optional(),
  responseScale: z.enum(['agreement', 'frequency']).optional(),
  openQuestions: z.array(z.string().trim().min(1).max(1000)).max(10).optional(),
});

/** GET /api/admin/formal-review-cycles */
export const GET = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    query: listQuerySchema,
    companyFrom: 'query',
    logLabel: 'formal-review-cycles GET',
  },
  async ({ companyId, query }) => {
    const cycles = await listFormalReviewCycles(null, { companyId, limit: query.limit });
    return NextResponse.json({ ok: true, cycles });
  }
);

/** POST /api/admin/formal-review-cycles */
export const POST = withAdminApi(
  {
    cap: CAP.PERFORMANCE_VIEW,
    body: createBodySchema,
    companyFrom: 'body',
    logLabel: 'formal-review-cycles POST',
  },
  async ({ request, payload, companyId, body }) => {
    const result = await withTransaction(db => createFormalReviewCycle(db, {
      companyId,
      title: body.title,
      description: body.description || '',
      model: body.model,
      includeSelf: body.includeSelf,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      createdByUserId: payload.userId,
      competencyIds: body.competencyIds,
      questionnaireOverrides: body.questionnaire,
      instructions: body.instructions,
      responseScale: body.responseScale,
      openQuestions: body.openQuestions,
    }));
    if (!result.ok) {
      return apiErrorFromResult(request, result, { fallbackCode: ERR.CREATE_FAILED });
    }
    await audit({
      action: 'formal_review_cycle_create',
      actorUserId: payload.userId,
      targetType: 'formal_review_cycle',
      targetId: result.cycle.id,
      metadata: {
        companyId,
        title: result.cycle.title,
        model: result.cycle.model,
        includeSelf: result.cycle.includeSelf,
      },
    });
    return NextResponse.json({ ok: true, cycle: result.cycle }, { status: 201 });
  }
);
