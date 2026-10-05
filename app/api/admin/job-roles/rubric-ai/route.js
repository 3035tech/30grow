import { NextResponse } from 'next/server';
import { withAdminApi } from '../../../../../lib/admin-api.js';
import { CAP } from '../../../../../lib/ae/require-admin.js';
import { apiError, ERR, httpStatusForError } from '../../../../../lib/api-error.js';
import { normalizeLocale } from '../../../../../lib/i18n.js';
import {
  isRubricAiConfigured,
  suggestJobRoleRubricFromText,
} from '../../../../../lib/rubric-ai.js';
import { checkRateLimit, clientIpFromRequest } from '../../../../../lib/rate-limit.js';
import { z } from '../../../../../lib/validate.js';

const bodySchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional().nullable().default(''),
  locale: z.string().trim().max(16).optional(),
});

/**
 * POST /api/admin/job-roles/rubric-ai
 * Sugere pesos T1–T9 (%) a partir do nome/descrição do cargo (mesmo motor da Fit da vaga).
 * Depth: app/api/admin/job-roles/rubric-ai → 5× ../ até lib/
 */
export const POST = withAdminApi(
  {
    cap: CAP.JOB_ROLES_VIEW,
    body: bodySchema,
    requireCompany: false,
    companyFrom: 'none',
    logLabel: 'job-roles/rubric-ai POST',
  },
  async ({ request, payload, body }) => {
    if (!isRubricAiConfigured()) {
      return apiError(request, ERR.RUBRIC_AI_NOT_CONFIGURED, httpStatusForError(ERR.RUBRIC_AI_NOT_CONFIGURED));
    }

    const ip = clientIpFromRequest(request);
    const rl = await checkRateLimit(`job-role-rubric-ai:${payload.userId || ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) {
      return apiError(request, ERR.RATE_LIMIT, 429, {}, { headers: { 'Retry-After': String(rl.retryAfterSec) } });
    }

    const locale = normalizeLocale(body.locale || payload?.locale || 'pt-BR');

    try {
      const out = await suggestJobRoleRubricFromText(
        { name: body.name, description: body.description || '' },
        locale,
        { companyId: payload.companyId ?? null, userId: payload.userId }
      );
      return NextResponse.json({
        ok: true,
        rubric: out.rubric,
        weights: out.weights,
        notes: out.notes || null,
        model: out.model,
      });
    } catch (e) {
      const code = e?.code || 'RUBRIC_AI_FAILED';
      if (code === 'RUBRIC_AI_PARSE' || code === ERR.RUBRIC_AI_PARSE) {
        return NextResponse.json(
          { error: 'RUBRIC_AI_PARSE', errorCode: ERR.RUBRIC_AI_PARSE, raw: e.raw || null },
          { status: 422 }
        );
      }
      if (code === 'RUBRIC_AI_NEED_CONTEXT' || code === ERR.RUBRIC_AI_NEED_CONTEXT) {
        return apiError(request, ERR.RUBRIC_AI_NEED_CONTEXT, httpStatusForError(ERR.RUBRIC_AI_NEED_CONTEXT));
      }
      const errorCode = typeof code === 'string' ? code : 'RUBRIC_AI_FAILED';
      return apiError(request, errorCode, httpStatusForError(errorCode, 502));
    }
  }
);
